import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    lead: { findMany: vi.fn(), update: vi.fn() },
    campaign: { findUnique: vi.fn() },
    conversation: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    conversationMessage: { create: vi.fn() },
    account: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    nativeAgent: { findUnique: vi.fn() },
  },
}));

vi.mock("../services/queue.service", () => ({ chatbotQueue: { add: vi.fn() } }));
vi.mock("../services/log.service", () => ({ createLog: vi.fn() }));
vi.mock("../services/flow.service", () => ({
  advanceOnEvent: vi.fn(),
  hasFlow: vi.fn(() => false),
}));
vi.mock("../services/unipile.service", () => ({ unipile: { getProfile: vi.fn() } }));
vi.mock("../services/chatbot-ai.service", () => ({
  getOrCreateConversation: vi.fn(),
  recordMessage: vi.fn(),
  isConversationLocked: vi.fn(() => false),
}));
vi.mock("../config/env", () => ({ env: {} }));
vi.mock("../utils/time", () => ({ randomInt: (min: number) => min }));

import { prisma } from "../lib/prisma";
import { chatbotQueue } from "../services/queue.service";
import { createLog } from "../services/log.service";
import { getOrCreateConversation } from "../services/chatbot-ai.service";
import {
  pickBestLead,
  parseWebhookBody,
  handleWebhookEvent,
  type WebhookLeadCandidate,
} from "./webhooks.routes";

function lead(overrides: Partial<WebhookLeadCandidate>): WebhookLeadCandidate {
  return {
    id: "L",
    campaignId: "C",
    createdAt: new Date("2026-08-28T12:00:00Z"),
    campaign: { status: "RUNNING" },
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("pickBestLead", () => {
  it("returns null when no leads match", () => {
    expect(pickBestLead([])).toBeNull();
  });

  it("prefers a RUNNING campaign over a completed one", () => {
    const running = lead({ id: "L1", campaign: { status: "RUNNING" } });
    const completed = lead({ id: "L2", campaign: { status: "COMPLETED" } });
    expect(pickBestLead([completed, running])?.id).toBe("L1");
  });
});

describe("handleWebhookEvent", () => {
  const account = { id: "A1", unipileAccountId: "UA1", providerId: "OWN1" };

  it("ignora mensagem de conta própria (anti-loop)", async () => {
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(account);
    await handleWebhookEvent({
      event: "message_received",
      message: "olá",
      chat_id: "CHAT1",
      account_info: { user_id: "OWN1", account_id: "UA1" },
      sender: { attendee_provider_id: "OWN1", name: "Eu" },
    });
    expect(createLog).toHaveBeenCalledWith(expect.objectContaining({ type: "BOT_SELF_MESSAGE" }));
    expect(chatbotQueue.add).not.toHaveBeenCalled();
  });

  it("ignora mensagem quando o agente nativo está desligado", async () => {
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(account);
    (prisma.nativeAgent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ enabled: false });
    (prisma.lead.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await handleWebhookEvent({
      event: "message_received",
      message: "olá",
      chat_id: "CHAT1",
      account_info: { user_id: "OWN1", account_id: "UA1" },
      sender: { attendee_provider_id: "P1", name: "João" },
    });
    expect(createLog).toHaveBeenCalledWith(expect.objectContaining({ type: "AGENT_DISABLED" }));
    expect(chatbotQueue.add).not.toHaveBeenCalled();
  });

  it("enfileira job com accountId para mensagem de lead de campanha", async () => {
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(account);
    (prisma.nativeAgent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true,
      replyDelayMin: 30,
      replyDelayMax: 30,
    });
    (prisma.lead.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      lead({ id: "L1", campaignId: "C1", providerId: "P1", name: "João" }),
    ]);
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "C1", accountId: "A1", flow: "" });
    (getOrCreateConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CONV1", status: "BOT" });
    await handleWebhookEvent({
      event: "message_received",
      message: "olá",
      chat_id: "CHAT1",
      account_info: { user_id: "OWN1", account_id: "UA1" },
      sender: { attendee_provider_id: "P1", name: "João" },
    });
    expect(chatbotQueue.add).toHaveBeenCalledWith(
      "reply",
      expect.objectContaining({ accountId: "A1", chatId: "CHAT1", campaignId: "C1", leadId: "L1", message: "olá" }),
      expect.objectContaining({ delay: 30000 }),
    );
  });

  it("enfileira job sem lead para conversa nativa", async () => {
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(account);
    (prisma.nativeAgent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      enabled: true,
      replyDelayMin: 30,
      replyDelayMax: 30,
    });
    (prisma.lead.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getOrCreateConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CONV1", status: "BOT" });
    await handleWebhookEvent({
      event: "message_received",
      message: "olá",
      chat_id: "CHAT2",
      account_info: { user_id: "OWN1", account_id: "UA1" },
      sender: { attendee_provider_id: "P9", name: "Maria" },
    });
    expect(chatbotQueue.add).toHaveBeenCalledWith(
      "reply",
      expect.objectContaining({ accountId: "A1", chatId: "CHAT2", campaignId: null, leadId: null, message: "olá" }),
      expect.any(Object),
    );
  });
});

describe("parseWebhookBody", () => {
  it("usa o corpo bruto quando é JSON", () => {
    const raw = JSON.stringify({ event: "message_received" });
    expect(parseWebhookBody({}, raw)).toEqual({ event: "message_received" });
  });
});
