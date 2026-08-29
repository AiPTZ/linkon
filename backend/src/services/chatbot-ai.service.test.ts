import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    lead: { findUnique: vi.fn(), update: vi.fn() },
    account: { findUnique: vi.fn(), update: vi.fn() },
    nativeAgent: { findUnique: vi.fn() },
    conversation: { upsert: vi.fn(), update: vi.fn() },
    conversationMessage: { create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("./unipile.service", () => ({
  unipile: { sendChatMessage: vi.fn() },
}));

vi.mock("./log.service", () => ({ createLog: vi.fn() }));
vi.mock("./notification.service", () => ({ notify: vi.fn() }));
vi.mock("./ai.service", () => ({
  generateDecision: vi.fn(),
  generateInitialMessage: vi.fn(),
  parseKnowledgeBase: vi.fn((raw: string) => {
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  }),
  isJailbreak: vi.fn(() => false),
  estimateCost: vi.fn(() => 0.001),
  CONFIDENCE_THRESHOLD: 0.6,
}));
vi.mock("./native-agent.service", () => ({
  refreshAgentCounters: vi.fn(),
  agentWithinLimits: vi.fn(),
}));

import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { generateDecision } from "./ai.service";
import { refreshAgentCounters, agentWithinLimits } from "./native-agent.service";
import {
  handleIncomingMessage,
  getOrCreateConversation,
  transferToHuman,
  resolveInitialMessage,
  isConversationLocked,
} from "./chatbot-ai.service";

const account = {
  id: "A1",
  unipileAccountId: "UA1",
  agentRepliesToday: 0,
  agentRepliesWeek: 0,
  agentRepliesDayDate: null,
  agentRepliesWeekDate: null,
} as never;

const agent = {
  id: "AG1",
  accountId: "A1",
  enabled: true,
  knowledgeBase: JSON.stringify({ product: "LinkON", faq: [], prices: [], differentiators: [], objections: [] }),
  tone: "consultivo",
  transferMessage: "Vou te conectar com um especialista.",
  replyDelayMin: 30,
  replyDelayMax: 30,
  maxTurns: 6,
  replyDailyLimit: 100,
  replyWeeklyLimit: 400,
  initialMessageMode: "TEMPLATE",
  initialTemplate: "",
} as never;

const campaign = { id: "C1", name: "Campanha Tech", accountId: "A1", inviteMessage: "Oi" } as never;

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

beforeEach(() => vi.clearAllMocks());

describe("getOrCreateConversation", () => {
  it("faz upsert por unipileChatId com campos opcionais nulos", async () => {
    (prisma.conversation.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CONV1" });
    const out = await getOrCreateConversation({ accountId: "A1", unipileChatId: "CHAT1" });
    expect(out).toEqual({ id: "CONV1" });
    expect(prisma.conversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ accountId: "A1", campaignId: null, leadId: null, unipileChatId: "CHAT1" }),
      }),
    );
  });
});

describe("transferToHuman", () => {
  it("usa o texto padrão quando transferText é vazio", async () => {
    (unipile.sendChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    await transferToHuman({ accountId: "A1", chatId: "CHAT1", conversationId: "CONV1", reason: "teste" });
    expect(unipile.sendChatMessage).toHaveBeenCalledWith("CHAT1", "Vou conectar você com um especialista do nosso time.");
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "NEEDS_HUMAN" }) }),
    );
  });
});

describe("handleIncomingMessage", () => {
  it("retorna none quando a conta não existe", async () => {
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await handleIncomingMessage({ accountId: "A1", chatId: "CHAT1", message: "oi" })).toBe("none");
  });

  it("retorna none quando o agente está desligado", async () => {
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(account);
    (prisma.nativeAgent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...agent, enabled: false });
    expect(await handleIncomingMessage({ accountId: "A1", chatId: "CHAT1", message: "oi" })).toBe("none");
  });

  it("transfere para humano ao atingir o limite de respostas", async () => {
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(account);
    (prisma.nativeAgent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(agent);
    (refreshAgentCounters as ReturnType<typeof vi.fn>).mockResolvedValue(account);
    (agentWithinLimits as ReturnType<typeof vi.fn>).mockReturnValue({ ok: false, reason: "limite diário de respostas atingido" });
    (prisma.conversation.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CONV1", status: "BOT" });
    (unipile.sendChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const action = await handleIncomingMessage({ accountId: "A1", chatId: "CHAT1", message: "oi" });
    expect(action).toBe("transfer");
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "NEEDS_HUMAN" }) }),
    );
  });

  it("ignora mensagem quando a conversa está em atendimento humano", async () => {
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(account);
    (prisma.nativeAgent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(agent);
    (prisma.conversation.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CONV1", status: "HUMAN" });
    const action = await handleIncomingMessage({ accountId: "A1", chatId: "CHAT1", message: "oi" });
    expect(action).toBe("ignore");
  });

  it("envia resposta e incrementa os contadores quando o LLM responde", async () => {
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(account);
    (prisma.nativeAgent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(agent);
    (refreshAgentCounters as ReturnType<typeof vi.fn>).mockResolvedValue(account);
    (agentWithinLimits as ReturnType<typeof vi.fn>).mockReturnValue({ ok: true });
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(campaign);
    (prisma.lead.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(lead);
    (prisma.conversation.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CONV1", status: "BOT" });
    (prisma.conversationMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { role: "LEAD", content: "oi" },
      { role: "BOT", content: "olá" },
    ]);
    (generateDecision as ReturnType<typeof vi.fn>).mockResolvedValue({
      reply: "Olá João!",
      canAnswer: true,
      confidence: 0.9,
      transfer: false,
      tokensIn: 10,
      tokensOut: 20,
    });
    (unipile.sendChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ message_id: "M1" });
    const action = await handleIncomingMessage({ accountId: "A1", chatId: "CHAT1", message: "oi", campaignId: "C1", leadId: "L1" });
    expect(action).toBe("reply");
    expect(unipile.sendChatMessage).toHaveBeenCalledWith("CHAT1", "Olá João!");
    expect(prisma.account.update).toHaveBeenCalledWith({
      where: { id: "A1" },
      data: { agentRepliesToday: { increment: 1 }, agentRepliesWeek: { increment: 1 } },
    });
    expect(prisma.lead.update).toHaveBeenCalled();
  });
});

describe("resolveInitialMessage", () => {
  it("usa o fallback quando o agente não existe", async () => {
    (prisma.nativeAgent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const text = await resolveInitialMessage({ id: "C1", name: "Campanha Tech", accountId: "A1", inviteMessage: "Oi!" } as never, { name: "João", headline: "CEO" } as never);
    expect(text).toBe("Oi!");
  });

  it("usa o fallback quando initialMessageMode não é AI", async () => {
    (prisma.nativeAgent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...agent, initialMessageMode: "TEMPLATE" });
    const text = await resolveInitialMessage({ id: "C1", name: "Campanha Tech", accountId: "A1", inviteMessage: "Oi!" } as never, { name: "João", headline: "CEO" } as never);
    expect(text).toBe("Oi!");
  });
});

describe("isConversationLocked", () => {
  it("bloqueia apenas NEEDS_HUMAN, HUMAN e CLOSED", () => {
    expect(isConversationLocked("BOT")).toBe(false);
    expect(isConversationLocked("NEEDS_HUMAN")).toBe(true);
    expect(isConversationLocked("HUMAN")).toBe(true);
    expect(isConversationLocked("CLOSED")).toBe(true);
  });
});
