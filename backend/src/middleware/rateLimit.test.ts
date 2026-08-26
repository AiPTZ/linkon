import { describe, expect, it, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { _clearRateLimitBucketsForTests, rateLimit } from "./rateLimit";

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

function mockRes(): { res: Response; m: MockRes } {
  const m: MockRes = { statusCode: 0, headers: {}, body: null };
  const res = {
    status(code: number) {
      m.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      m.headers[name.toLowerCase()] = value;
      return res;
    },
    json(body: unknown) {
      m.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, m };
}

function mockReq(ip: string) {
  return { ip } as Request;
}

describe("rateLimit middleware", () => {
  beforeEach(() => {
    _clearRateLimitBucketsForTests();
  });

  it("permite requisições dentro do limite", () => {
    const mw = rateLimit({ windowMs: 60_000, max: 2 });
    const { res, m } = mockRes();
    let nexted = 0;
    const next: NextFunction = () => {
      nexted += 1;
    };

    mw(mockReq("1.1.1.1"), res, next);
    mw(mockReq("1.1.1.1"), res, next);

    expect(nexted).toBe(2);
    expect(m.statusCode).toBe(0);
  });

  it("bloqueia com 429 quando o limite é excedido", () => {
    const mw = rateLimit({ windowMs: 60_000, max: 2 });
    const { res, m } = mockRes();
    const next: NextFunction = () => undefined;

    mw(mockReq("1.1.1.1"), res, next);
    mw(mockReq("1.1.1.1"), res, next);
    mw(mockReq("1.1.1.1"), res, next);

    expect(m.statusCode).toBe(429);
    expect(m.headers["retry-after"]).toBeTruthy();
  });

  it("não bloqueia IPs distintos entre si", () => {
    const mw = rateLimit({ windowMs: 60_000, max: 1 });
    const { res, m } = mockRes();
    let nexted = 0;
    const next: NextFunction = () => {
      nexted += 1;
    };

    mw(mockReq("1.1.1.1"), res, next);
    mw(mockReq("2.2.2.2"), res, next);
    mw(mockReq("3.3.3.3"), res, next);

    expect(nexted).toBe(3);
    expect(m.statusCode).toBe(0);
  });

  it("aceita chave personalizada por usuário", () => {
    const mw = rateLimit({
      windowMs: 60_000,
      max: 1,
      key: (req) => (req.body as { username?: string } | undefined)?.username ?? req.ip ?? "unknown",
    });
    const { res, m } = mockRes();
    let nexted = 0;
    const next: NextFunction = () => {
      nexted += 1;
    };

    const reqA = { ip: "1.1.1.1", body: { username: "alice" } } as Request;
    const reqB = { ip: "1.1.1.1", body: { username: "bob" } } as Request;

    mw(reqA, res, next);
    mw(reqA, res, next);
    mw(reqB, res, next);

    expect(nexted).toBe(2);
    expect(m.statusCode).toBe(429);
  });
});
