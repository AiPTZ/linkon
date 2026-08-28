import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    conversation: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    conversationMessage: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("./unipile.service", () => ({ unipile: { sendChatMessage: vi.fn() } }));

import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { listInbox, sendHumanMessage, claimConversation } from "./inbox.service";
import { ApiError } from "../utils/errors";

beforeEach(() => vi.clearAllMocks());

describe("listInbox", () => {
  it("lista conversas do usuário com status NEEDS_HUMAN primeiro", async () => {
    (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "CV1", status: "NEEDS_HUMAN", lastMessageAt: new Date(), lead: { name: "João", headline: "CEO", profileUrl: null }, campaign: { id: "C1", name: "Tech", mode: "DISPARO" } },
    ]);
    (prisma.conversation.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (prisma.conversationMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ content: "oi", role: "LEAD" });
    (prisma.conversationMessage.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const res = await listInbox("U1");
    expect(res.items).toHaveLength(1);
    expect(res.items[0].lastMessage).toBe("oi");
    expect(res.items[0].unread).toBe(0);
    expect(res.needsHuman).toBe(1);
    const arg = (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where).toEqual({ campaign: { userId: "U1" } });
    expect(arg.include.campaign.select).toMatchObject({ id: true, name: true, mode: true });
  });
});

describe("sendHumanMessage", () => {
  it("envia mensagem como humano e marca conversa HUMAN", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CV1", accountId: "A1", unipileChatId: "CHAT1" });
    (unipile.sendChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ message_id: "M1" });
    (prisma.conversationMessage.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "MSG1", role: "HUMAN", content: "oi" });

    const msg = await sendHumanMessage("CV1", "U1", "Olá, tudo bem?");
    expect(msg.id).toBe("MSG1");
    expect(unipile.sendChatMessage).toHaveBeenCalledWith("CHAT1", "Olá, tudo bem?");
    const createArg = (prisma.conversationMessage.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArg.data.role).toBe("HUMAN");
    const upd = (prisma.conversation.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upd.where.id).toBe("CV1");
    expect(upd.data.status).toBe("HUMAN");
  });

  it("lança 404 quando a conversa não é do usuário", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(sendHumanMessage("CV1", "U1", "oi")).rejects.toThrow(ApiError);
    expect(unipile.sendChatMessage).not.toHaveBeenCalled();
  });
});

describe("claimConversation", () => {
  it("marca conversa como HUMAN", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CV1", accountId: "A1", unipileChatId: "CHAT1" });
    const res = await claimConversation("CV1", "U1");
    expect(res.ok).toBe(true);
    const upd = (prisma.conversation.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upd.data.status).toBe("HUMAN");
  });
});
