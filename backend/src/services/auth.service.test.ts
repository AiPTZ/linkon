import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    account: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), count: vi.fn(), create: vi.fn() },
    campaign: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("./unipile.service", () => ({
  unipile: {
    deleteAccount: vi.fn(),
    listAccounts: vi.fn(),
    createHostedAuthLink: vi.fn(),
    connectLinkedinNative: vi.fn(),
  },
}));

vi.mock("../utils/crypto", () => ({
  encrypt: (v: string) => v,
  decrypt: (v: string) => v,
}));

vi.mock("./log.service", () => ({ createLog: vi.fn() }));

vi.mock("./queue.service", () => ({ contactsQueue: { add: vi.fn() } }));

import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { contactsQueue } from "./queue.service";
import {
  disconnectAccount,
  confirmHosted,
  syncAccounts,
  connectNative,
  assertCanConnectLinkedIn,
} from "./auth.service";
import { ApiError, UnipileError } from "../utils/errors";
import type { Account } from "@prisma/client";

const accountFind = prisma.account.findUnique as ReturnType<typeof vi.fn>;
const accountUpdate = prisma.account.update as ReturnType<typeof vi.fn>;
const accountUpsert = prisma.account.upsert as ReturnType<typeof vi.fn>;
const accountCount = prisma.account.count as ReturnType<typeof vi.fn>;
const campaignUpdateMany = prisma.campaign.updateMany as ReturnType<typeof vi.fn>;
const transaction = prisma.$transaction as ReturnType<typeof vi.fn>;
const deleteAccount = unipile.deleteAccount as ReturnType<typeof vi.fn>;
const listAccounts = unipile.listAccounts as ReturnType<typeof vi.fn>;
const connectLinkedinNative = unipile.connectLinkedinNative as ReturnType<typeof vi.fn>;
const queueAdd = contactsQueue.add as ReturnType<typeof vi.fn>;

const account: Account = {
  id: "A1",
  unipileAccountId: "UA1",
  provider: "LINKEDIN",
  username: "arcanjo",
  authMethod: "NATIVE",
  status: "OK",
  checkpointType: null,
  credentialsEnc: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as Account;

beforeEach(() => {
  vi.clearAllMocks();
  accountUpsert.mockResolvedValue({ id: "A1" });
  accountCount.mockResolvedValue(0);
  accountFind.mockResolvedValue(account);
  accountUpdate.mockResolvedValue({ id: "A1" });
  transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
});

describe("disconnectAccount", () => {
  it("desconecta na Unipile e marca a conta local como DISCONNECTED", async () => {
    await disconnectAccount("A1");

    expect(deleteAccount).toHaveBeenCalledWith("UA1");
    const accountArg = accountUpdate.mock.calls[0][0] as {
      where: { id: string };
      data: { status: string };
    };
    expect(accountArg.where.id).toBe("A1");
    expect(accountArg.data.status).toBe("DISCONNECTED");
    const campaignArg = campaignUpdateMany.mock.calls[0][0] as {
      where: { accountId: string; status: { in: string[] } };
      data: { status: string };
    };
    expect(campaignArg.where.accountId).toBe("A1");
    expect(campaignArg.where.status.in).toEqual(["RUNNING", "IMPORTING"]);
    expect(campaignArg.data.status).toBe("PAUSED");
  });

  it("lança erro quando a conta não existe", async () => {
    accountFind.mockResolvedValue(null);
    await expect(disconnectAccount("A1")).rejects.toThrow(ApiError);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("propaga erro da Unipile sem marcar a conta local", async () => {
    deleteAccount.mockRejectedValue(new Error("Unipile offline"));
    await expect(disconnectAccount("A1")).rejects.toThrow("Unipile offline");
    expect(accountUpdate).not.toHaveBeenCalled();
    expect(campaignUpdateMany).not.toHaveBeenCalled();
  });

  it("tolera conta já removida na Unipile e marca a conta local como DISCONNECTED", async () => {
    deleteAccount.mockRejectedValue(
      new UnipileError(404, "errors/not_found", "The requested resource were not found. Account not found"),
    );

    await expect(disconnectAccount("A1")).resolves.toBeUndefined();

    const accountArg = accountUpdate.mock.calls[0][0] as {
      where: { id: string };
      data: { status: string };
    };
    expect(accountArg.where.id).toBe("A1");
    expect(accountArg.data.status).toBe("DISCONNECTED");
    const campaignArg = campaignUpdateMany.mock.calls[0][0] as {
      where: { accountId: string; status: { in: string[] } };
      data: { status: string };
    };
    expect(campaignArg.where.accountId).toBe("A1");
    expect(campaignArg.data.status).toBe("PAUSED");
  });
});

describe("assertCanConnectLinkedIn", () => {
  it("permite quando o usuário não possui contas", async () => {
    accountCount.mockResolvedValue(0);
    await expect(assertCanConnectLinkedIn("U1")).resolves.toBeUndefined();
  });

  it("bloqueia com 409 quando o usuário já possui uma conta não-rejeitada", async () => {
    accountCount.mockResolvedValue(1);
    await expect(assertCanConnectLinkedIn("U1")).rejects.toMatchObject({ status: 409 });
  });
});

describe("confirmHosted", () => {
  it("cria conta PENDING_LINKEDIN para usuário sem contas", async () => {
    listAccounts.mockResolvedValue({
      items: [{ id: "UA1", name: "linkon-connect-U1-1700000000000" }],
    });
    const res = await confirmHosted("U1", { pending: true });
    expect(res.accounts).toBe(1);
    const create = accountUpsert.mock.calls[0][0] as { create: { status: string; userId: string } };
    expect(create.create.status).toBe("PENDING_LINKEDIN");
    expect(create.create.userId).toBe("U1");
  });

  it("bloqueia segunda conta de usuário que já possui uma não-rejeitada", async () => {
    accountCount.mockResolvedValue(1);
    listAccounts.mockResolvedValue({
      items: [{ id: "UA1", name: "linkon-connect-U1-1700000000000" }],
    });
    await expect(confirmHosted("U1", { pending: true })).rejects.toMatchObject({ status: 409 });
    expect(accountUpsert).not.toHaveBeenCalled();
  });

  it("reconfirmação da mesma conta do usuário é idempotente (sem 409)", async () => {
    accountFind.mockResolvedValue({ id: "A1", unipileAccountId: "UA1", userId: "U1" });
    accountCount.mockResolvedValue(1);
    listAccounts.mockResolvedValue({
      items: [{ id: "UA1", name: "linkon-connect-U1-1700000000000" }],
    });
    const res = await confirmHosted("U1", { pending: true });
    expect(res.accounts).toBe(0);
    const update = accountUpdate.mock.calls[0][0] as { data: { status: string } };
    expect(update.data.status).toBe("PENDING_LINKEDIN");
    expect(accountUpsert).not.toHaveBeenCalled();
  });

  it("ignora contas sem marcador do usuário", async () => {
    listAccounts.mockResolvedValue({ items: [{ id: "UA2", name: "Outro nome" }] });
    const res = await confirmHosted("U1", { pending: true });
    expect(res.accounts).toBe(0);
    expect(accountUpsert).not.toHaveBeenCalled();
  });
});

describe("confirmHosted (sync de rede)", () => {
  it("enfileira sync-network com o id local da conta criada (não o id da API do Unipile)", async () => {
    listAccounts.mockResolvedValue({
      items: [{ id: "UA1", name: "linkon-connect-U1-1700000000000" }],
    });
    accountFind.mockResolvedValue(null);
    await confirmHosted("U1", { pending: false });
    expect(queueAdd).toHaveBeenCalledWith("sync-network", { accountId: "A1" });
  });

  it("enfileira sync-network com o id local ao reconfirmar conta existente OK", async () => {
    listAccounts.mockResolvedValue({
      items: [{ id: "UA1", name: "linkon-connect-U1-1700000000000" }],
    });
    accountFind.mockResolvedValue({ id: "A1", unipileAccountId: "UA1", userId: "U1", status: "PENDING_LINKEDIN" });
    accountUpdate.mockResolvedValue({ id: "A1", status: "OK" });
    await confirmHosted("U1", { pending: false });
    expect(queueAdd).toHaveBeenCalledWith("sync-network", { accountId: "A1" });
  });
});

describe("connectNative", () => {
  it("bloqueia com 409 quando userId é fornecido e o usuário já possui conta", async () => {
    accountCount.mockResolvedValue(1);
    await expect(connectNative("user", "pass", undefined, { userId: "U1" })).rejects.toMatchObject({
      status: 409,
    });
    expect(connectLinkedinNative).not.toHaveBeenCalled();
  });

  it("não verifica limite quando userId não é fornecido", async () => {
    connectLinkedinNative.mockResolvedValue({
      account_id: "UA1",
      provider_id: "P1",
      first_name: "F",
    });
    const res = await connectNative("user", "pass", undefined, { userId: null });
    expect(accountCount).not.toHaveBeenCalled();
    expect(res.localAccountId).toBe("A1");
    expect(accountUpsert).toHaveBeenCalled();
  });
});

describe("syncAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserva conta PENDING_LINKEDIN durante sync", async () => {
    listAccounts.mockResolvedValue({
      items: [{ id: "UA1", name: "linkon-connect-U1-1700000000000", sources: [{ status: "OK" }] }],
    });
    accountFind.mockResolvedValue({ ...account, status: "PENDING_LINKEDIN", userId: "U1" });
    await syncAccounts();
    expect(accountUpdate).not.toHaveBeenCalled();
  });

  it("preserva conta REJECTED durante sync", async () => {
    listAccounts.mockResolvedValue({
      items: [{ id: "UA1", name: "linkon-connect-U1-1700000000000", sources: [{ status: "OK" }] }],
    });
    accountFind.mockResolvedValue({ ...account, status: "REJECTED", userId: "U1" });
    await syncAccounts();
    expect(accountUpdate).not.toHaveBeenCalled();
  });

  it("atualiza status de conta comum e cria contas novas", async () => {
    listAccounts.mockResolvedValue({ items: [{ id: "UA1", name: "arcanjo", sources: [{ status: "OK" }] }] });
    accountFind.mockResolvedValue(account);
    await syncAccounts();
    expect(accountUpdate).toHaveBeenCalled();
  });
});
