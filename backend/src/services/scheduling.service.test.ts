import { describe, expect, it } from "vitest";
import {
  parseAvailabilityWindows,
  parseWindowsInput,
  slotLabel,
  generateSlots,
  extractEmail,
  matchSlot,
  type Slot,
} from "./scheduling.service";
import { ApiError } from "../utils/errors";

describe("parseAvailabilityWindows", () => {
  it("retorna [] para string inválida", () => {
    expect(parseAvailabilityWindows("não é json")).toEqual([]);
    expect(parseAvailabilityWindows("")).toEqual([]);
  });

  it("filtra janelas inválidas", () => {
    const raw = JSON.stringify([
      { weekday: 1, startMin: 540, endMin: 1080 },
      { weekday: 9, startMin: 0, endMin: 60 },
      { weekday: 2, startMin: 120, endMin: 60 },
      { weekday: 3, startMin: -5, endMin: 60 },
    ]);
    const out = parseAvailabilityWindows(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ weekday: 1, startMin: 540, endMin: 1080 });
  });
});

describe("parseWindowsInput", () => {
  it("aceita janelas válidas", () => {
    const out = parseWindowsInput([{ weekday: 1, startMin: 540, endMin: 1080 }]);
    expect(out).toHaveLength(1);
  });

  it("lança ApiError em overlap no mesmo dia", () => {
    expect(() =>
      parseWindowsInput([
        { weekday: 1, startMin: 540, endMin: 720 },
        { weekday: 1, startMin: 600, endMin: 1080 },
      ]),
    ).toThrow(ApiError);
  });

  it("lança ApiError quando start >= end", () => {
    expect(() => parseWindowsInput([{ weekday: 1, startMin: 120, endMin: 60 }])).toThrow(ApiError);
  });
});

describe("slotLabel", () => {
  it("formata o horário no fuso configurado", () => {
    const label = slotLabel("2026-09-01T12:00:00.000Z");
    expect(label).toMatch(/às \d{2}:\d{2}/);
  });
});

describe("generateSlots", () => {
  it("gera slots dentro das janelas, descontando ocupados e passado", () => {
    const windows = [{ weekday: 1, startMin: 540, endMin: 1080 }]; // 09:00-18:00
    const now = new Date("2026-08-31T10:00:00.000Z"); // segunda 07:00 BRT
    const occupied = [{ start: new Date("2026-08-31T13:00:00.000Z"), end: new Date("2026-08-31T14:00:00.000Z") }];
    const slots = generateSlots({ windows, durationMin: 30, occupied, now, count: 5 });
    expect(slots).toHaveLength(5);
    expect(slots[0].start).toBe("2026-08-31T12:00:00.000Z"); // primeira janela às 09:00 BRT
    const occupiedOverlap = slots.filter((s) => new Date(s.start) < occupied[0].end && occupied[0].start < new Date(s.end));
    expect(occupiedOverlap).toHaveLength(0);
  });

  it("não gera slot que começa antes de now", () => {
    const windows = [{ weekday: 0, startMin: 0, endMin: 1440 }];
    const now = new Date("2026-08-30T15:00:00.000Z");
    const slots = generateSlots({ windows, durationMin: 60, occupied: [], now, count: 10 });
    expect(slots.length).toBeGreaterThan(0);
    expect(new Date(slots[0].start).getTime()).toBeGreaterThanOrEqual(now.getTime());
  });
});

describe("extractEmail", () => {
  it("extrai e-mail em maiúsculas/minúsculas variadas", () => {
    expect(extractEmail("meu email é JoAo@X.Com.br obrigado")).toBe("joao@x.com.br");
  });

  it("retorna null sem e-mail", () => {
    expect(extractEmail("me liga no 11 99999")).toBeNull();
  });
});

describe("matchSlot", () => {
  const slots: Slot[] = [
    { start: "a", end: "b", label: "seg., 01/09 às 14:00" },
    { start: "c", end: "d", label: "ter., 02/09 às 10:00" },
    { start: "e", end: "f", label: "qua., 03/09 às 16:30" },
  ];

  it("matcheia por número", () => {
    expect(matchSlot("opção 2 por favor", slots)).toEqual({ index: 1 });
  });

  it("matcheia por hint de horário", () => {
    expect(matchSlot("quinta as 14h", slots)).toEqual({ index: 0 });
  });

  it("retorna needsConfirmation quando o hint é ambíguo", () => {
    expect(matchSlot("pode ser de manhã?", slots)).toEqual({ needsConfirmation: true });
  });

  it("retorna needsConfirmation quando não há hint de horário", () => {
    expect(matchSlot("qualquer coisa", slots)).toEqual({ needsConfirmation: true });
  });
});
