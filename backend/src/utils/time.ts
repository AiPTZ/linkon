import { env } from "../config/env";

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomDelayMs(minMinutes: number, maxMinutes: number): number {
  const minutes = randomInt(minMinutes, maxMinutes);
  return minutes * 60_000 + Math.floor(Math.random() * 60_000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TzParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function tzParts(date: Date, timeZone: string): TzParts {
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
  const dateSec = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - dateSec;
}

export function isWorkHour(now: Date, startHour: number, endHour: number): boolean {
  const hour = tzParts(now, env.APP_TIMEZONE).hour;
  return hour >= startHour && hour < endHour;
}

export function startOfLocalDay(now: Date): Date {
  const p = tzParts(now, env.APP_TIMEZONE);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0, 0) - tzOffsetMs(now, env.APP_TIMEZONE));
}

export function startOfLocalWeek(now: Date): Date {
  const p = tzParts(now, env.APP_TIMEZONE);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const diffToMonday = (weekday + 6) % 7;
  return new Date(startOfLocalDay(now).getTime() - diffToMonday * 86_400_000);
}
