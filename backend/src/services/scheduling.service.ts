import { env } from "../config/env";
import { ApiError } from "../utils/errors";

export interface AvailabilityWindow {
  weekday: number;
  startMin: number;
  endMin: number;
}

export interface Slot {
  start: string;
  end: string;
  label: string;
}

export function parseAvailabilityWindows(raw: string): AvailabilityWindow[] {
  try {
    const arr = JSON.parse(raw ?? "[]");
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (w): w is AvailabilityWindow =>
        Boolean(w) &&
        Number.isInteger(w.weekday) &&
        w.weekday >= 0 &&
        w.weekday <= 6 &&
        Number.isInteger(w.startMin) &&
        Number.isInteger(w.endMin) &&
        w.startMin >= 0 &&
        w.endMin <= 1440 &&
        w.startMin < w.endMin,
    );
  } catch {
    return [];
  }
}

export function parseWindowsInput(body: unknown): AvailabilityWindow[] {
  if (!Array.isArray(body)) throw new ApiError(400, "Janelas devem ser uma lista");
  const windows = parseAvailabilityWindows(JSON.stringify(body));
  if (windows.length !== body.length) {
    throw new ApiError(400, "Janela inválida: weekday 0-6, 0 <= startMin < endMin <= 1440");
  }
  const byDay = new Map<number, AvailabilityWindow[]>();
  for (const w of windows) {
    const arr = byDay.get(w.weekday) ?? [];
    arr.push(w);
    byDay.set(w.weekday, arr);
  }
  for (const arr of byDay.values()) {
    arr.sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].startMin < arr[i - 1].endMin) {
        throw new ApiError(400, "Janelas não podem se sobrepor no mesmo dia");
      }
    }
  }
  return windows;
}

function tzParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string): number => Number(parts.find((x) => x.type === t)?.value ?? 0);
  const hour = get("hour") === 24 ? 0 : get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const p = tzParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function slotLabel(isoStart: string): string {
  const dtf = new Intl.DateTimeFormat("pt-BR", {
    timeZone: env.APP_TIMEZONE,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(isoStart));
  const get = (t: string): string => parts.find((x) => x.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")}/${get("month")} às ${get("hour")}:${get("minute")}`;
}

export function generateSlots(input: {
  windows: AvailabilityWindow[];
  durationMin: number;
  occupied: { start: Date; end: Date }[];
  now: Date;
  count: number;
}): Slot[] {
  const { windows, durationMin, occupied, now, count } = input;
  const slots: Slot[] = [];
  const overlaps = (start: Date, end: Date) =>
    occupied.some((o) => start < o.end && o.start < end);

  for (let dayOffset = 0; dayOffset < 10 && slots.length < count; dayOffset++) {
    const day = new Date(now.getTime() + dayOffset * 86_400_000);
    const p = tzParts(day, env.APP_TIMEZONE);
    const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    const ws = windows.filter((w) => w.weekday === weekday);
    for (const w of ws) {
      const midnightUtc = Date.UTC(p.year, p.month - 1, p.day) - tzOffsetMs(day, env.APP_TIMEZONE);
      const winStart = midnightUtc + w.startMin * 60_000;
      const winEnd = midnightUtc + w.endMin * 60_000;
      for (
        let t = winStart;
        t + durationMin * 60_000 <= winEnd && slots.length < count;
        t += durationMin * 60_000
      ) {
        const start = new Date(t);
        const end = new Date(t + durationMin * 60_000);
        if (start <= now) continue;
        if (overlaps(start, end)) continue;
        const iso = start.toISOString();
        slots.push({ start: iso, end: end.toISOString(), label: slotLabel(iso) });
      }
    }
  }
  return slots;
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export function extractEmail(text: string): string | null {
  const m = EMAIL_RE.exec(text);
  return m ? m[0].toLowerCase() : null;
}

export function matchSlot(
  text: string,
  slots: Slot[],
): { index: number } | { needsConfirmation: boolean } | null {
  const num = text.match(/\b([1-3])\b/);
  if (num && Number(num[1]) >= 1 && Number(num[1]) <= slots.length) {
    return { index: Number(num[1]) - 1 };
  }

  const lower = text.toLowerCase();
  const dayMatch = lower.match(/\b(seg|ter|qua|qui|sex|sáb|sab|dom)\b/);
  const hourMatch = lower.match(/(\d{1,2})(?::(\d{2})|h)/);
  if (!hourMatch) return { needsConfirmation: true };

  const hour = Number(hourMatch[1]);
  const minute = hourMatch[2] ? Number(hourMatch[2]) : 0;
  const padded = `às ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  const matches = slots
    .map((s, i) => ({ i, s }))
    .filter(({ s }) => {
      if (dayMatch && !s.label.toLowerCase().includes(dayMatch[1])) return false;
      return s.label.toLowerCase().includes(padded);
    });

  if (matches.length === 1) return { index: matches[0].i };
  if (matches.length > 1) return { needsConfirmation: true };
  return null;
}
