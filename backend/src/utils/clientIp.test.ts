import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { getClientIp } from "./clientIp";

function req(overrides: Partial<Request>): Request {
  return { ip: "127.0.0.1", headers: {}, ...overrides } as Request;
}

describe("getClientIp", () => {
  it("prefere o CF-Connecting-IP quando presente (Cloudflare)", () => {
    const r = req({ headers: { "cf-connecting-ip": "203.0.113.10", "x-forwarded-for": "198.51.100.5" } });
    expect(getClientIp(r)).toBe("203.0.113.10");
  });

  it("cai para req.ip quando não há header Cloudflare", () => {
    const r = req({ headers: { "x-forwarded-for": "198.51.100.5" } });
    expect(getClientIp(r)).toBe("127.0.0.1");
  });

  it("retorna unknown sem IP", () => {
    const r = req({ ip: undefined });
    expect(getClientIp(r)).toBe("unknown");
  });
});
