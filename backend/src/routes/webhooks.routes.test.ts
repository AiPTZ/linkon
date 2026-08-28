import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    lead: { findMany: vi.fn(), update: vi.fn() },
    campaign: { findUnique: vi.fn() },
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    conversationMessage: { create: vi.fn() },
    account: { findUnique: vi.fn() },
  },
}));

vi.mock("../services/queue.service", () => ({ chatbotQueue: { add: vi.fn() } }));
vi.mock("../services/log.service", () => ({ createLog: vi.fn() }));
vi.mock("../services/flow.service", () => ({
  advanceOnEvent: vi.fn(),
  hasFlow: vi.fn(() => false),
}));
vi.mock("../services/unipile.service", () => ({ unipile: { getProfile: vi.fn() } }));
vi.mock("../config/env", () => ({ env: {} }));

import { prisma } from "../lib/prisma";
import { chatbotQueue } from "../services/queue.service";
import { unipile } from "../services/unipile.service";
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
    campaign: { status: "RUNNING", chatbotEnabled: true },
    ...overrides,
  };
}

describe("pickBestLead", () => {
  it("returns null when no leads match", () => {
    expect(pickBestLead([])).toBeNull();
  });

  it("returns the only lead when a single candidate exists", () => {
    const only = lead({ id: "L1" });
    expect(pickBestLead([only])?.id).toBe("L1");
  });

  it("prefers a RUNNING campaign over a completed one", () => {
    const running = lead({ id: "L1", campaign: { status: "RUNNING", chatbotEnabled: false } });
    const completed = lead({ id: "L2", campaign: { status: "COMPLETED", chatbotEnabled: true } });
    expect(pickBestLead([completed, running])?.id).toBe("L1");
  });

  it("prefers a chatbot-enabled campaign when both are in the same state", () => {
    const disabled = lead({ id: "L1", campaign: { status: "COMPLETED", chatbotEnabled: false } });
    const enabled = lead({ id: "L2", campaign: { status: "COMPLETED", chatbotEnabled: true } });
    expect(pickBestLead([disabled, enabled])?.id).toBe("L2");
  });

  it("ties break to the most recently created lead", () => {
    const older = lead({
      id: "L1",
      createdAt: new Date("2026-08-27T12:00:00Z"),
      campaign: { status: "COMPLETED", chatbotEnabled: false },
    });
    const newer = lead({
      id: "L2",
      createdAt: new Date("2026-08-28T12:00:00Z"),
      campaign: { status: "COMPLETED", chatbotEnabled: false },
    });
    expect(pickBestLead([older, newer])?.id).toBe("L2");
  });
});

describe("parseWebhookBody", () => {
  it("parses a JSON body sent with a form content-type (Unipile quirk)", () => {
    const rawBody = '{"event":"message_received","chat_id":"abc","message":"opa"}';
    const parsed = parseWebhookBody({ '{"event":"message_received","chat_id":"abc","message":"opa"}': "" }, rawBody) as {
      event: string;
      chat_id: string;
    };
    expect(parsed.event).toBe("message_received");
    expect(parsed.chat_id).toBe("abc");
  });

  it("falls back to the parsed body when raw is not JSON", () => {
    const body = { event: "message_received", chat_id: "abc" };
    expect(parseWebhookBody(body, "event=message_received&chat_id=abc")).toEqual(body);
  });

  it("returns the parsed body when raw JSON is malformed", () => {
    const body = { event: "new_relation" };
    expect(parseWebhookBody(body, "{not json")).toEqual(body);
  });
});

describe("handleWebhookEvent (message_received)", () => {
  beforeEach(() => vi.clearAllMocks());

  const campaign = {
    id: "C1",
    accountId: "A1",
    chatbotEnabled: true,
    chatbotMode: "LLM",
    flow: null,
    chatbotReplyDelayMin: 30,
    chatbotReplyDelayMax: 30,
  };

  function seedLead(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "L1",
      campaignId: "C1",
      createdAt: new Date(),
      providerId: "P1",
      name: "João",
      headline: null,
      campaign: { status: "RUNNING", chatbotEnabled: true },
      ...overrides,
    };
  }

  const event = (overrides: Record<string, unknown> = {}) => ({
    event: "message_received",
    sender: { attendee_provider_id: "P1", name: "João" },
    account_info: { user_id: "ME" },
    chat_id: "CHAT1",
    message: "olá?",
    ...overrides,
  });

  function seedBasic() {
    (prisma.lead.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([seedLead()]);
    (prisma.campaign.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(campaign);
    (prisma.lead.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.conversationMessage.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "M1" });
    (prisma.conversation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  }

  it("enfileira o job do bot quando a conversa não existe", async () => {
    seedBasic();
    (prisma.conversation.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await handleWebhookEvent(event());
    expect(chatbotQueue.add).toHaveBeenCalledTimes(1);
    expect((chatbotQueue.add as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({
      chatId: "CHAT1",
      leadId: "L1",
      campaignId: "C1",
      message: "olá?",
    });
  });

  it("não enfileira e registra a mensagem do lead quando a conversa está travada", async () => {
    seedBasic();
    (prisma.conversation.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "CONV1",
      status: "NEEDS_HUMAN",
    });
    await handleWebhookEvent(event());
    expect(chatbotQueue.add).not.toHaveBeenCalled();
    const msgCreate = (prisma.conversationMessage.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msgCreate.data.role).toBe("LEAD");
    expect(msgCreate.data.content).toBe("olá?");
    const convUpdate = (prisma.conversation.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(convUpdate.where.id).toBe("CONV1");
  });

  it("sincroniza o nome do lead a partir do perfil quando o nome está ausente", async () => {
    seedBasic();
    (prisma.lead.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([seedLead({ name: null })]);
    (prisma.conversation.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "A1",
      unipileAccountId: "UA1",
    });
    (unipile.getProfile as ReturnType<typeof vi.fn>).mockResolvedValue({
      first_name: "João",
      last_name: "Silva",
      headline: "CEO",
    });

    await handleWebhookEvent(event());
    expect(unipile.getProfile).toHaveBeenCalledWith("UA1", "P1");
    const updates = (prisma.lead.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updates.some((c) => c[0].data && c[0].data.name === "João Silva")).toBe(true);
  });
});
