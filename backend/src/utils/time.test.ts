import { describe, expect, it } from "vitest";
import {
  isWorkHour,
  randomDelayMs,
  randomInt,
  startOfLocalDay,
  startOfLocalWeek,
} from "./time";

describe("randomInt", () => {
  it("returns values within inclusive bounds", () => {
    for (let i = 0; i < 200; i++) {
      const v = randomInt(5, 15);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(15);
    }
  });

  it("returns the bound itself when min equals max", () => {
    expect(randomInt(7, 7)).toBe(7);
  });
});

describe("randomDelayMs", () => {
  it("produces delays between min and max minutes", () => {
    for (let i = 0; i < 200; i++) {
      const delay = randomDelayMs(5, 15);
      expect(delay).toBeGreaterThanOrEqual(5 * 60_000);
      expect(delay).toBeLessThan(16 * 60_000);
    }
  });
});

describe("isWorkHour", () => {
  it("respects the window boundaries", () => {
    // Instantes em UTC correspondentes a horários de São Paulo (UTC-3)
    expect(isWorkHour(new Date("2026-01-01T12:00:00Z"), 9, 18)).toBe(true); // 09:00 SP
    expect(isWorkHour(new Date("2026-01-01T20:59:00Z"), 9, 18)).toBe(true); // 17:59 SP
    expect(isWorkHour(new Date("2026-01-01T11:59:00Z"), 9, 18)).toBe(false); // 08:59 SP
    expect(isWorkHour(new Date("2026-01-01T21:00:00Z"), 9, 18)).toBe(false); // 18:00 SP
  });
});

describe("startOfLocalDay / startOfLocalWeek", () => {
  it("zeroes the time portion", () => {
    const d = startOfLocalDay(new Date("2026-01-15T17:30:45.123Z"));
    expect(d.getUTCHours()).toBe(3); // meia-noite em SP = 03:00 UTC
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
    expect(d.getUTCDate()).toBe(15);
  });

  it("returns Monday as the week start", () => {
    const wednesday = new Date("2026-08-26T15:00:00Z"); // quarta-feira
    expect(wednesday.getUTCDay()).toBe(3);
    const monday = startOfLocalWeek(wednesday);
    expect(monday.getUTCDay()).toBe(1);
    expect(monday.getUTCDate()).toBe(24);
  });
});
