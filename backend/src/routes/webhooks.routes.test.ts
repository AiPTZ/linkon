import { describe, expect, it } from "vitest";
import { pickBestLead, parseWebhookBody, type WebhookLeadCandidate } from "./webhooks.routes";

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
