import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: { notification: { create: vi.fn() } },
}));

vi.mock("../utils/logger", () => ({
  logger: { error: vi.fn() },
}));

import { prisma } from "../lib/prisma";
import { notify } from "./notification.service";

const create = prisma.notification.create as ReturnType<typeof vi.fn>;

describe("notify", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cria uma notificação com defaults", async () => {
    create.mockResolvedValue({ id: "N1" });
    await notify({ type: "BROADCAST_STARTED", message: "Disparo iniciado." });
    expect(create).toHaveBeenCalledWith({
      data: {
        accountId: undefined,
        campaignId: undefined,
        type: "BROADCAST_STARTED",
        level: "INFO",
        message: "Disparo iniciado.",
        payload: undefined,
      },
    });
  });

  it("serializa o payload e preserva o nível", async () => {
    create.mockResolvedValue({ id: "N2" });
    await notify({
      accountId: "A1",
      campaignId: "C1",
      type: "BROADCAST_LIMIT_HIT",
      level: "WARN",
      message: "Limite atingido.",
      payload: { imported: 5 },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        accountId: "A1",
        campaignId: "C1",
        type: "BROADCAST_LIMIT_HIT",
        level: "WARN",
        message: "Limite atingido.",
        payload: '{"imported":5}',
      },
    });
  });

  it("não lança quando o create falha", async () => {
    create.mockRejectedValue(new Error("db down"));
    await expect(notify({ type: "X", message: "m" })).resolves.toBeUndefined();
  });
});
