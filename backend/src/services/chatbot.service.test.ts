import { describe, expect, it } from "vitest";
import {
  containsStopKeyword,
  parseKeywords,
  parseRules,
  ruleMatches,
  type ChatbotRule,
} from "./chatbot.service";

describe("ruleMatches", () => {
  it("matches 'contains' case-insensitively", () => {
    const rule: ChatbotRule = { matchType: "contains", pattern: "preço", reply: "ok" };
    expect(ruleMatches(rule, "Qual o PREÇO?")).toBe(true);
    expect(ruleMatches(rule, "bom dia")).toBe(false);
  });

  it("matches 'keywords' when any keyword is present", () => {
    const rule: ChatbotRule = { matchType: "keywords", pattern: "preço, valor, custo", reply: "ok" };
    expect(ruleMatches(rule, "qual o valor?")).toBe(true);
    expect(ruleMatches(rule, "sem assunto")).toBe(false);
  });

  it("matches 'regex' patterns", () => {
    const rule: ChatbotRule = { matchType: "regex", pattern: "^[0-9]{5}$", reply: "ok" };
    expect(ruleMatches(rule, "12345")).toBe(true);
    expect(ruleMatches(rule, "abcdef")).toBe(false);
  });

  it("does not throw on invalid regex", () => {
    const rule: ChatbotRule = { matchType: "regex", pattern: "[", reply: "ok" };
    expect(ruleMatches(rule, "qualquer texto")).toBe(false);
  });
});

describe("parseRules / parseKeywords", () => {
  it("parses JSON arrays", () => {
    expect(parseRules('[{"matchType":"contains","pattern":"a","reply":"b"}]')).toHaveLength(1);
    expect(parseRules("invalid")).toEqual([]);
    expect(parseKeywords('["a","b"]')).toEqual(["a", "b"]);
    expect(parseKeywords("invalid")).toEqual([]);
  });
});

describe("containsStopKeyword", () => {
  it("detects stop keywords case-insensitively", () => {
    expect(containsStopKeyword("Não quero mais", ["não quero", "pare"])).toBe(true);
    expect(containsStopKeyword("interessante", ["pare"])).toBe(false);
  });
});
