import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    lead: { findUnique: vi.fn(), update: vi.fn() },
    account: { findUnique: vi.fn() },
    conversation: { upsert: vi.fn(), update: vi.fn() },
    conversationMessage: { create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("./unipile.service", () => ({
  unipile: { sendChatMessage: vi.fn() },
}));

vi.mock("./log.service", () => ({ createLog: vi.fn() }));
vi.mock("./notification.service", () => ({ notify: vi.fn() }));

import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { handleIncomingMessage, getOrCreateConversation, transferToHuman, resolveInitialMessage } from "./chatbot-ai.service";

const campaign = {
  id: "C1",
  name: "Campanha Tech",
  accountId: "A1",
  chatbotEnabled: true,
  chatbotMode: "LLM",
  chatbotKnowledgeBase: JSON.stringify({
    product: "LinkON",
    faq: [{ q: "preço", a: "R$ 97" }],
    prices: ["R$ 97"],
    differentiators: [],
    objections: [],
  }),
  chatbotTone: "consultivo",
  chatbotStopKeywords: '["não quero", "pare"]',
  chatbotMaxTurns: 6,
  chatbotTransferMessage: "Vou te conectar com um especialista.",
} as never;

const lead = {
  id: "L1",
  campaignId: "C1",
  providerId: "P1",
  name: "João",
  headline: "CEO",
  status: "RESPONDED",
  replyCount: 0,
  lastMessageAt: null,
} as never;

const account = { id: "A1", unipileAccountId: "UA1" } as never;

beforeEach(() => vi.clearAllMocks());

describe("getOrCreateConversation", () => {
  it("faz upsert por unipileChatId", async () => {
    (prisma.conversation.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CONV1" });
    const conv = await getOrCreateConversation({
      campaignId: "C1",
      leadId: "L1",
      accountId: "A1",
      unipileChatId: "CHAT1",
    });
    expect(conv.id).toBe("CONV1");
    const arg = (prisma.conversation.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where.unipileChatId).toBe("CHAT1");
  });
});

describe("transferToHuman", () => {
  it("envia mensagem de transferência, marca NEEDS_HUMAN e notifica", async () => {
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(campaign);
    (unipile.sendChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ message_id: "M1" });
    await transferToHuman({
      campaignId: "C1",
      leadId: "L1",
      accountId: "A1",
      chatId: "CHAT1",
      conversationId: "CONV1",
      reason: "fora da base",
    });
    expect(unipile.sendChatMessage).toHaveBeenCalledWith("CHAT1", "Vou te conectar com um especialista.");
    const convUpdate = (prisma.conversation.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(convUpdate.where.id).toBe("CONV1");
    expect(convUpdate.data.status).toBe("NEEDS_HUMAN");
  });
});

describe("handleIncomingMessage", () => {
  it("responde quando a IA responde com canAnswer true", async () => {
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(campaign);
    (prisma.lead.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(lead);
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(account);
    (prisma.conversation.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CONV1" });
    (prisma.conversationMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (unipile.sendChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ message_id: "M1" });

    const aiModule = await import("./ai.service");
    vi.spyOn(aiModule, "generateDecision").mockResolvedValue({
      reply: "A partir de R$ 97/mês.",
      canAnswer: true,
      confidence: 0.9,
      tokensIn: 100,
      tokensOut: 50,
    });

    const action = await handleIncomingMessage({
      campaignId: "C1",
      leadId: "L1",
      chatId: "CHAT1",
      message: "qual o preço?",
    });

    expect(action).toBe("reply");
    expect(unipile.sendChatMessage).toHaveBeenCalledWith("CHAT1", "A partir de R$ 97/mês.");
    const msgCreate = (prisma.conversationMessage.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msgCreate.data.role).toBe("LEAD");
    const botMsg = (prisma.conversationMessage.create as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(botMsg.data.role).toBe("BOT");
    expect(botMsg.data.costUsd).toBeCloseTo(100 / 1e6 * 0.15 + 50 / 1e6 * 0.6);
  });

  it("transfere quando a IA responde canAnswer false", async () => {
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(campaign);
    (prisma.lead.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(lead);
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(account);
    (prisma.conversation.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CONV1" });
    (prisma.conversationMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (unipile.sendChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ message_id: "M1" });

    const aiModule = await import("./ai.service");
    vi.spyOn(aiModule, "generateDecision").mockResolvedValue({
      reply: "Vou te conectar com um especialista.",
      canAnswer: false,
      confidence: 0.1,
      tokensIn: 100,
      tokensOut: 50,
    });

    const action = await handleIncomingMessage({
      campaignId: "C1",
      leadId: "L1",
      chatId: "CHAT1",
      message: "vocês fazem X?",
    });
    expect(action).toBe("transfer");
  });

  it("ignora mensagem com palavra de parada", async () => {
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(campaign);
    (prisma.lead.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(lead);
    (prisma.conversation.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CONV1" });
    const action = await handleIncomingMessage({
      campaignId: "C1",
      leadId: "L1",
      chatId: "CHAT1",
      message: "não quero mais contato",
    });
    expect(action).toBe("ignore");
  });

  it("transfere quando o limite de turnos é atingido", async () => {
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(campaign);
    (prisma.lead.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...(lead as Record<string, unknown>), replyCount: 6 });
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(account);
    (prisma.conversation.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CONV1" });
    (unipile.sendChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ message_id: "M1" });
    const action = await handleIncomingMessage({
      campaignId: "C1",
      leadId: "L1",
      chatId: "CHAT1",
      message: "qual o preço?",
    });
    expect(action).toBe("transfer");
  });

  it("retorna none quando a campanha não existe", async () => {
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const action = await handleIncomingMessage({ campaignId: "C9", leadId: "L1", chatId: "C", message: "oi" });
    expect(action).toBe("none");
  });
});

describe("resolveInitialMessage", () => {
  it("retorna inviteMessage em modo RULES sem chamar o LLM", async () => {
    const aiModule = await import("./ai.service");
    const spy = vi.spyOn(aiModule, "generateInitialMessage").mockResolvedValue({ text: "X", tokensIn: 0, tokensOut: 0 });
    const out = await resolveInitialMessage(
      { ...(campaign as Record<string, unknown>), chatbotMode: "RULES", inviteMessage: "Olá da rede!" } as never,
      lead as never,
    );
    expect(out).toBe("Olá da rede!");
    expect(spy).not.toHaveBeenCalled();
  });

  it("retorna inviteMessage em modo LLM+TEMPLATE sem chamar o LLM", async () => {
    const aiModule = await import("./ai.service");
    const spy = vi.spyOn(aiModule, "generateInitialMessage").mockResolvedValue({ text: "X", tokensIn: 0, tokensOut: 0 });
    const out = await resolveInitialMessage(
      { ...(campaign as Record<string, unknown>), chatbotMode: "LLM", chatbotInitialMessageMode: "TEMPLATE", inviteMessage: "Olá da rede!" } as never,
      lead as never,
    );
    expect(out).toBe("Olá da rede!");
    expect(spy).not.toHaveBeenCalled();
  });

  it("gera mensagem personalizada em modo LLM+AI", async () => {
    const aiModule = await import("./ai.service");
    vi.spyOn(aiModule, "generateInitialMessage").mockResolvedValue({ text: "Oi João, bora conversar?", tokensIn: 50, tokensOut: 20 });
    const out = await resolveInitialMessage(
      { ...(campaign as Record<string, unknown>), chatbotMode: "LLM", chatbotInitialMessageMode: "AI", chatbotInitialTemplate: "Template base", inviteMessage: "" } as never,
      lead as never,
    );
    expect(out).toBe("Oi João, bora conversar?");
  });

  it("cai para inviteMessage quando o LLM falha", async () => {
    const aiModule = await import("./ai.service");
    vi.spyOn(aiModule, "generateInitialMessage").mockRejectedValue(new Error("falha"));
    const out = await resolveInitialMessage(
      { ...(campaign as Record<string, unknown>), chatbotMode: "LLM", chatbotInitialMessageMode: "AI", chatbotInitialTemplate: "T", inviteMessage: "Olá da rede!" } as never,
      lead as never,
    );
    expect(out).toBe("Olá da rede!");
  });
});
