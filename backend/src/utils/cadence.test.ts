import { describe, expect, it } from "vitest";
import { cadenceItemSchema, cadenceSchema, parseCadence } from "./cadence";

describe("parseCadence", () => {
  it("parseia JSON válido", () => {
    expect(parseCadence('[{"body":"Oi {nome}","waitDays":3}]')).toEqual([
      { body: "Oi {nome}", waitDays: 3 },
    ]);
  });

  it("retorna [] para null, undefined ou string vazia", () => {
    expect(parseCadence(null)).toEqual([]);
    expect(parseCadence(undefined)).toEqual([]);
    expect(parseCadence("")).toEqual([]);
  });

  it("retorna [] para JSON inválido ou não-array", () => {
    expect(parseCadence("não é json")).toEqual([]);
    expect(parseCadence('{"a":1}')).toEqual([]);
  });

  it("filtra itens com shape inválido", () => {
    expect(parseCadence('[{"body":"ok","waitDays":2},{"body":123,"waitDays":2}]')).toEqual([
      { body: "ok", waitDays: 2 },
    ]);
  });
});

describe("cadence schemas (zod)", () => {
  it("aceita 1..5 itens válidos", () => {
    const ok = [
      { body: "c1", waitDays: 2 },
      { body: "c2", waitDays: 7 },
    ];
    expect(cadenceSchema.parse(ok)).toEqual(ok);
  });

  it("aceita array ausente (optional)", () => {
    expect(cadenceSchema.parse(undefined)).toBeUndefined();
  });

  it("rejeita 6 itens", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ body: `c${i}`, waitDays: 1 }));
    expect(() => cadenceSchema.parse(six)).toThrow();
  });

  it("rejeita body vazio, body >300 e waitDays fora de 1..90", () => {
    expect(() => cadenceItemSchema.parse({ body: "", waitDays: 1 })).toThrow();
    expect(() => cadenceItemSchema.parse({ body: "x".repeat(301), waitDays: 1 })).toThrow();
    expect(() => cadenceItemSchema.parse({ body: "ok", waitDays: 0 })).toThrow();
    expect(() => cadenceItemSchema.parse({ body: "ok", waitDays: 91 })).toThrow();
    expect(() => cadenceItemSchema.parse({ body: "ok", waitDays: 1.5 })).toThrow();
  });
});
