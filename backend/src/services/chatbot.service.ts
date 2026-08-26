import type { Campaign } from "@prisma/client";

export interface ChatbotRule {
  matchType: "contains" | "keywords" | "regex";
  pattern: string;
  reply: string;
}

export function parseRules(raw: string): ChatbotRule[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatbotRule[]) : [];
  } catch {
    return [];
  }
}

export function parseKeywords(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function ruleMatches(rule: ChatbotRule, message: string): boolean {
  const hay = message.toLowerCase();
  switch (rule.matchType) {
    case "contains":
      return rule.pattern.trim().length > 0 && hay.includes(rule.pattern.trim().toLowerCase());
    case "keywords":
      return rule.pattern
        .toLowerCase()
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
        .some((k) => hay.includes(k));
    case "regex":
      try {
        return new RegExp(rule.pattern, "i").test(message);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export function generateReply(campaign: Campaign, message: string): string | null {
  const rules = parseRules(campaign.chatbotRules);
  for (const rule of rules) {
    if (ruleMatches(rule, message)) return rule.reply;
  }
  return campaign.chatbotDefaultReply || null;
}

export function containsStopKeyword(message: string, stopKeywords: string[]): boolean {
  const hay = message.toLowerCase();
  return stopKeywords.some((k) => k.trim() && hay.includes(k.trim().toLowerCase()));
}
