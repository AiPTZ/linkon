import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed"), compare: vi.fn().mockResolvedValue(true) },
  hash: vi.fn().mockResolvedValue("hashed"),
  compare: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    campaign: { updateMany: vi.fn() },
  },
}));

import { prisma } from "../lib/prisma";
import { loginUser, registerUser, createUser, changePassword, approveUser, blockUser, setUserPro, userHasAI } from "./user.service";
import { ApiError } from "../utils/errors";

const userFind = prisma.user.findUnique as ReturnType<typeof vi.fn>;
const userCreate = prisma.user.create as ReturnType<typeof vi.fn>;
const userUpdate = prisma.user.update as ReturnType<typeof vi.fn>;
const campaignUpdateMany = prisma.campaign.updateMany as ReturnType<typeof vi.fn>;

const baseUser = { id: "U1", name: "Fulano", username: "fulano", passwordHash: "$2a$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", whatsapp: "5511999999999", role: "USER", status: "ACTIVE", pro: false, createdAt: new Date(), updatedAt: new Date() };

describe("loginUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejeita usuário PENDING", async () => {
    userFind.mockResolvedValue({ ...baseUser, status: "PENDING" });
    await expect(loginUser("fulano", "qualquer")).rejects.toThrow("Aguardando aprovação");
  });

  it("rejeita usuário BLOCKED", async () => {
    userFind.mockResolvedValue({ ...baseUser, status: "BLOCKED" });
    await expect(loginUser("fulano", "qualquer")).rejects.toThrow("Acesso bloqueado");
  });

  it("retorna token com role/status para usuário ATIVO", async () => {
    userFind.mockResolvedValue(baseUser);
    const res = await loginUser("fulano", "senha123");
    expect(res.user.role).toBe("USER");
    expect(res.user.status).toBe("ACTIVE");
    expect(res.token.length).toBeGreaterThan(20);
  });
});

describe("registerUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cria usuário PENDING", async () => {
    userFind.mockResolvedValue(null);
    userCreate.mockResolvedValue({ ...baseUser, status: "PENDING" });
    const u = await registerUser({ name: "Fulano", username: "fulano", password: "senha123", whatsapp: "5511999999999" });
    expect(u.status).toBe("PENDING");
    expect(userCreate.mock.calls[0][0].data.role).toBe("USER");
  });

  it("rejeita username duplicado", async () => {
    userFind.mockResolvedValue(baseUser);
    await expect(registerUser({ name: "F", username: "fulano", password: "senha123" })).rejects.toThrow(ApiError);
  });
});

describe("createUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cria usuário ATIVO pelo admin", async () => {
    userFind.mockResolvedValue(null);
    userCreate.mockResolvedValue({ ...baseUser, status: "ACTIVE" });
    const u = await createUser({ name: "Novo", username: "novo", password: "senha123", whatsapp: "5511999999999" });
    expect(u.status).toBe("ACTIVE");
    expect(u.role).toBe("USER");
    expect(userCreate.mock.calls[0][0].data.status).toBe("ACTIVE");
  });

  it("rejeita username duplicado", async () => {
    userFind.mockResolvedValue(baseUser);
    await expect(createUser({ name: "Novo", username: "fulano", password: "senha123" })).rejects.toThrow(ApiError);
  });
});

describe("setUserPro", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grava pro=true quando usuário existe", async () => {
    userFind.mockResolvedValue({ ...baseUser, pro: false });
    userUpdate.mockResolvedValue({ ...baseUser, pro: true });
    const out = await setUserPro("U1", true);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "U1" },
      data: { pro: true },
    });
    expect(out.pro).toBe(true);
  });

  it("lança 404 quando usuário não existe", async () => {
    userFind.mockResolvedValue(null);
    await expect(setUserPro("X", true)).rejects.toThrow("Usuário não encontrado");
  });
});

describe("userHasAI", () => {
  beforeEach(() => vi.clearAllMocks());

  it("permite id nulo (conta global)", async () => {
    expect(await userHasAI(null)).toBe(true);
  });

  it("permite ADMIN", async () => {
    userFind.mockResolvedValue({ ...baseUser, role: "ADMIN", pro: false });
    expect(await userHasAI("U1")).toBe(true);
  });

  it("permite USER com pro ativo", async () => {
    userFind.mockResolvedValue({ ...baseUser, role: "USER", pro: true });
    expect(await userHasAI("U1")).toBe(true);
  });

  it("bloqueia USER sem pro", async () => {
    userFind.mockResolvedValue({ ...baseUser, role: "USER", pro: false });
    expect(await userHasAI("U1")).toBe(false);
  });

  it("bloqueia USER com pro mas status BLOCKED", async () => {
    userFind.mockResolvedValue({ ...baseUser, role: "USER", pro: true, status: "BLOCKED" });
    expect(await userHasAI("U1")).toBe(false);
  });

  it("permite quando usuário não existe mais", async () => {
    userFind.mockResolvedValue(null);
    expect(await userHasAI("X")).toBe(true);
  });
});

describe("blockUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bloqueia e pausa campanhas ativas", async () => {
    userFind.mockResolvedValue(baseUser);
    userUpdate.mockResolvedValue({ ...baseUser, status: "BLOCKED" });
    await blockUser("U1");
    const arg = campaignUpdateMany.mock.calls[0][0] as { where: { userId: string; status: { in: string[] } }; data: { status: string } };
    expect(arg.where.userId).toBe("U1");
    expect(arg.where.status.in).toEqual(["RUNNING", "IMPORTING"]);
    expect(arg.data.status).toBe("PAUSED");
  });
});
