import { describe, expect, it } from "vitest";
import { resolveScope, assertAccountInScope } from "./scope";
import { ApiError } from "./errors";

function req(role: string, operateAs?: string) {
  const headers: Record<string, string> = {};
  if (operateAs) headers["x-operate-as"] = operateAs;
  return { user: { sub: "U1", username: "x", role, status: "ACTIVE" }, headers } as unknown as Parameters<typeof resolveScope>[0];
}

describe("resolveScope", () => {
  it("usuário comum resolve para o próprio id", () => {
    expect(resolveScope(req("USER"))).toEqual({ userId: "U1" });
  });
  it("admin sem contexto resolve para null (base global)", () => {
    expect(resolveScope(req("ADMIN"))).toEqual({ userId: null });
  });
  it("admin com X-Operate-As resolve para o usuário alvo", () => {
    expect(resolveScope(req("ADMIN", "U2"))).toEqual({ userId: "U2" });
  });
});

describe("assertAccountInScope", () => {
  it("permite conta do usuário no escopo do usuário", () => {
    expect(() => assertAccountInScope({ userId: "U1" }, "U1")).not.toThrow();
  });
  it("bloqueia conta de outro usuário", () => {
    expect(() => assertAccountInScope({ userId: "U2" }, "U1")).toThrow(ApiError);
  });
  it("bloqueia conta global para usuário comum", () => {
    expect(() => assertAccountInScope({ userId: null }, "U1")).toThrow(ApiError);
  });
  it("admin global pode usar contas globais", () => {
    expect(() => assertAccountInScope({ userId: null }, null)).not.toThrow();
  });
});
