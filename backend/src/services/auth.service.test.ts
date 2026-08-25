import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    account: { findUnique: vi.fn(), update: vi.fn() },
    campaign: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("./unipile.service", () => ({
  unipile: { deleteAccount: vi.fn() },
}));

vi.mock("./log.service", () => ({ createLog: vi.fn() }));

import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { disconnectAccount } from "./auth.service";
import { ApiError } from "../utils/errors";
import type { Account } from "@prisma/client";

const accountFind = prisma.account.findUnique as ReturnType<typeof vi.fn>;
const accountUpdate = prisma.account.update as ReturnType<typeof vi.fn>;
const campaignUpdateMany = prisma.campaign.updateMany as ReturnType<typeof vi.fn>;
const transaction = prisma.$transaction as ReturnType<typeof vi.fn>;
const deleteAccount = unipile.deleteAccount as ReturnType<typeof vi.fn>;

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

describe("disconnectAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountFind.mockResolvedValue(account);
    transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
  });

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
});
