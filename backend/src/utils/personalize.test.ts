import { describe, expect, it } from "vitest";
import { applyPlaceholders } from "./personalize";

describe("applyPlaceholders", () => {
  it("substitui nome, cargo e link quando presentes", () => {
    const out = applyPlaceholders("Oi {nome}, vi seu cargo {cargo}. Perfil: {link}", {
      name: "João",
      headline: "CTO",
      profileUrl: "https://linkedin.com/in/joao",
    });
    expect(out).toBe("Oi João, vi seu cargo CTO. Perfil: https://linkedin.com/in/joao");
  });

  it("substitui campos ausentes por string vazia", () => {
    expect(
      applyPlaceholders("Oi {nome} {cargo} {link}", { name: null, headline: null, profileUrl: null }),
    ).toBe("Oi   ");
  });

  it("mantém texto sem placeholders intacto", () => {
    expect(applyPlaceholders("Olá da rede!", { name: "João" })).toBe("Olá da rede!");
  });
});
