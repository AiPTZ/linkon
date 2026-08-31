import { env } from "../config/env";
import { ApiError } from "../utils/errors";
import { prisma } from "../lib/prisma";
import { encrypt, decrypt } from "../utils/crypto";
import { unipile } from "./unipile.service";
import { createLog } from "./log.service";
import { notify } from "./notification.service";
import { recordMessage, transferToHuman, type BotAction } from "./chatbot-ai.service";
import { generateExtraction, generateConfirmationMessage } from "./ai.service";
import { createEventRobust } from "./calendar.service";

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

export type ScheduleState = "NONE" | "OFFERING" | "AWAITING_EMAIL" | "CONFIRMING" | "BOOKED" | "FAILED";

export interface SchedulingContext {
  userId: string | null;
  conversation: {
    id: string;
    scheduleState: string;
    scheduleData: string;
    unipileChatId: string;
  };
  accountId: string;
  leadId: string | null;
  campaignId: string | null;
  leadName: string | null;
  agent: {
    schedulingEnabled: boolean;
    meetingDurationMin: number;
    meetingTitle: string;
    tone: string;
    transferMessage: string;
  };
  productName: string;
}

interface ScheduleData {
  slots: Slot[];
  offeringRound: number;
  emailAttempts: number;
  email: string | null;
  chosenSlot?: Slot;
  stateUpdatedAt: string;
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 1)}***@${domain}`;
}

function parseScheduleData(raw: string): ScheduleData {
  try {
    const d = JSON.parse(raw ?? "{}") as Partial<ScheduleData>;
    return {
      slots: Array.isArray(d.slots) ? d.slots : [],
      offeringRound: Number.isInteger(d.offeringRound) ? (d.offeringRound as number) : 1,
      emailAttempts: Number.isInteger(d.emailAttempts) ? (d.emailAttempts as number) : 0,
      email: typeof d.email === "string" ? d.email : null,
      chosenSlot: d.chosenSlot,
      stateUpdatedAt: typeof d.stateUpdatedAt === "string" ? d.stateUpdatedAt : new Date().toISOString(),
    };
  } catch {
    return { slots: [], offeringRound: 1, emailAttempts: 0, email: null, stateUpdatedAt: new Date().toISOString() };
  }
}

async function setSchedule(conversationId: string, state: ScheduleState, data: unknown): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      scheduleState: state,
      scheduleData: JSON.stringify(data),
      lastMessageAt: new Date(),
    },
  });
}

async function sendBotMessage(ctx: Pick<SchedulingContext, "accountId" | "conversation">, text: string): Promise<void> {
  const res = await unipile.sendChatMessage(ctx.conversation.unipileChatId, text);
  await recordMessage({ conversationId: ctx.conversation.id, role: "BOT", content: text, messageId: res?.message_id });
  await prisma.account.update({
    where: { id: ctx.accountId },
    data: { agentRepliesToday: { increment: 1 }, agentRepliesWeek: { increment: 1 } },
  });
}

async function transferScheduling(ctx: SchedulingContext, reason: string): Promise<BotAction> {
  await transferToHuman({
    accountId: ctx.accountId,
    chatId: ctx.conversation.unipileChatId,
    conversationId: ctx.conversation.id,
    reason,
    transferText: ctx.agent.transferMessage,
    campaignId: ctx.campaignId,
    leadId: ctx.leadId,
  });
  await prisma.conversation.update({
    where: { id: ctx.conversation.id },
    data: { scheduleState: "FAILED", scheduleData: JSON.stringify({ reason }), lastMessageAt: new Date() },
  });
  return "transfer";
}

async function loadWindowsAndOccupied(ctx: SchedulingContext): Promise<{
  windows: { weekday: number; startMin: number; endMin: number }[];
  occupied: { start: Date; end: Date }[];
}> {
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId ?? "none" },
    include: { sellerAvailability: true },
  });
  const windows = parseAvailabilityWindows(user?.sellerAvailability?.windows ?? "[]");
  const occupied = (await prisma.booking.findMany({
    where: {
      userId: ctx.userId ?? "none",
      status: { in: ["CONFIRMED", "CONFIRMING"] },
      startTime: { gte: new Date() },
    },
    select: { startTime: true, endTime: true },
  })).map((b) => ({ start: b.startTime, end: b.endTime }));
  return { windows, occupied };
}

async function regenerateSlots(ctx: SchedulingContext): Promise<Slot[]> {
  const { windows, occupied } = await loadWindowsAndOccupied(ctx);
  return generateSlots({
    windows,
    durationMin: ctx.agent.meetingDurationMin,
    occupied,
    now: new Date(),
    count: 3,
  });
}

export async function startBooking(ctx: SchedulingContext): Promise<BotAction> {
  if (!ctx.userId || !ctx.agent.schedulingEnabled) {
    return transferScheduling(ctx, "calendar_unavailable");
  }
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    include: { calendarConnection: true, sellerAvailability: true },
  });
  const connected = user?.calendarConnection?.status === "CONNECTED";
  const windows = parseAvailabilityWindows(user?.sellerAvailability?.windows ?? "[]");
  if (!connected || windows.length === 0) {
    return transferScheduling(ctx, "calendar_unavailable");
  }
  const slots = await regenerateSlots(ctx);
  if (slots.length === 0) return transferScheduling(ctx, "calendar_unavailable");

  const data: ScheduleData = {
    slots,
    offeringRound: 1,
    emailAttempts: 0,
    email: null,
    stateUpdatedAt: new Date().toISOString(),
  };
  await setSchedule(ctx.conversation.id, "OFFERING", data);

  try {
    const extraction = await generateExtraction({
      tone: ctx.agent.tone,
      leadName: ctx.leadName,
      state: "OFFERING",
      slots: slots.map((s) => ({ label: s.label })),
      message: "",
      transferMessage: ctx.agent.transferMessage,
    });
    await sendBotMessage(ctx, extraction.reply);
  } catch (err) {
    return transferScheduling(ctx, `falha técnica do LLM (${(err as Error).message})`);
  }
  return "reply";
}

export async function advanceScheduling(
  ctx: SchedulingContext & { message: string },
): Promise<BotAction> {
  const data = parseScheduleData(ctx.conversation.scheduleData);
  const state = ctx.conversation.scheduleState;

  if (state === "OFFERING") return resolveOffering(ctx, data);
  if (state === "AWAITING_EMAIL") return resolveAwaitingEmail(ctx, data);
  return "none";
}

async function resolveOffering(ctx: SchedulingContext & { message: string }, data: ScheduleData): Promise<BotAction> {
  const extraction = await generateExtraction({
    tone: ctx.agent.tone,
    leadName: ctx.leadName,
    state: "OFFERING",
    slots: data.slots.map((s) => ({ label: s.label })),
    message: ctx.message,
    transferMessage: ctx.agent.transferMessage,
  });
  const ex = extraction.extracted;

  if (ex.offTopic || ex.wantsToCancel) {
    await setSchedule(ctx.conversation.id, "NONE", { ...data, stateUpdatedAt: new Date().toISOString() });
    await sendBotMessage(ctx, extraction.reply);
    return "reply";
  }

  let index: number | null = null;
  if (typeof ex.chosenSlotIndex === "number" && ex.chosenSlotIndex >= 1 && ex.chosenSlotIndex <= data.slots.length) {
    index = ex.chosenSlotIndex - 1;
  } else {
    const match = matchSlot(ctx.message, data.slots);
    if (match && "index" in match) index = match.index;
    else if (match && "needsConfirmation" in match) {
      await sendBotMessage(ctx, extraction.reply);
      return "reply";
    }
  }

  if (ex.wantsOtherTimes || index === null) {
    const round = data.offeringRound + 1;
    if (round > 3) return transferScheduling(ctx, "no_slot_accepted");
    const newSlots = await regenerateSlots(ctx);
    if (newSlots.length === 0) return transferScheduling(ctx, "no_slot_accepted");
    const newData: ScheduleData = { ...data, slots: newSlots, offeringRound: round, stateUpdatedAt: new Date().toISOString() };
    await setSchedule(ctx.conversation.id, "OFFERING", newData);
    const newExtraction = await generateExtraction({
      tone: ctx.agent.tone,
      leadName: ctx.leadName,
      state: "OFFERING",
      slots: newSlots.map((s) => ({ label: s.label })),
      message: "",
      transferMessage: ctx.agent.transferMessage,
    });
    await sendBotMessage(ctx, newExtraction.reply);
    return "reply";
  }

  const chosen = data.slots[index];
  const newData: ScheduleData = { ...data, chosenSlot: chosen, emailAttempts: 0, stateUpdatedAt: new Date().toISOString() };
  await setSchedule(ctx.conversation.id, "AWAITING_EMAIL", newData);
  const askEmail = await generateExtraction({
    tone: ctx.agent.tone,
    leadName: ctx.leadName,
    state: "AWAITING_EMAIL",
    emailAttempts: 0,
    message: "",
    transferMessage: ctx.agent.transferMessage,
  });
  await sendBotMessage(ctx, askEmail.reply);
  return "reply";
}

async function resolveAwaitingEmail(ctx: SchedulingContext & { message: string }, data: ScheduleData): Promise<BotAction> {
  const extraction = await generateExtraction({
    tone: ctx.agent.tone,
    leadName: ctx.leadName,
    state: "AWAITING_EMAIL",
    emailAttempts: data.emailAttempts,
    message: ctx.message,
    transferMessage: ctx.agent.transferMessage,
  });
  const ex = extraction.extracted;

  if (ex.offTopic || ex.wantsToCancel) {
    await setSchedule(ctx.conversation.id, "NONE", { ...data, stateUpdatedAt: new Date().toISOString() });
    await sendBotMessage(ctx, extraction.reply);
    return "reply";
  }

  const email = extractEmail(ctx.message) ?? (typeof ex.email === "string" && ex.email ? ex.email.toLowerCase() : null);
  if (!email) {
    const attempts = data.emailAttempts + 1;
    if (attempts >= 2) return transferScheduling(ctx, "invalid_email");
    await setSchedule(ctx.conversation.id, "AWAITING_EMAIL", { ...data, emailAttempts: attempts, stateUpdatedAt: new Date().toISOString() });
    await sendBotMessage(ctx, extraction.reply);
    return "reply";
  }

  const newData: ScheduleData = { ...data, email, stateUpdatedAt: new Date().toISOString() };
  await setSchedule(ctx.conversation.id, "CONFIRMING", newData);
  return completeBooking(ctx, newData);
}

async function completeBooking(ctx: SchedulingContext, data: ScheduleData): Promise<BotAction> {
  const chosen = data.chosenSlot;
  const email = data.email;
  if (!chosen || !email) return transferScheduling(ctx, "no_slot_accepted");
  if (!ctx.userId) return transferScheduling(ctx, "calendar_unavailable");

  const calendar = await prisma.calendarConnection.findUnique({ where: { userId: ctx.userId } });
  if (!calendar || calendar.status !== "CONNECTED" || !calendar.refreshToken) {
    return transferScheduling(ctx, "calendar_unavailable");
  }
  let refreshToken: string;
  try {
    refreshToken = decrypt(calendar.refreshToken);
  } catch {
    return transferScheduling(ctx, "calendar_unavailable");
  }

  const title = (ctx.agent.meetingTitle || `Reunião ${ctx.productName} com ${ctx.leadName ?? "lead"}`).trim();

  let bookingId: string;
  try {
    bookingId = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.create({
        data: {
          userId: ctx.userId as string,
          accountId: ctx.accountId,
          conversationId: ctx.conversation.id,
          leadName: ctx.leadName,
          leadEmail: email,
          startTime: new Date(chosen.start),
          endTime: new Date(chosen.end),
          title,
          status: "CONFIRMING",
        },
      });
      return booking.id;
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      const newSlots = await regenerateSlots(ctx);
      const newData: ScheduleData = {
        slots: newSlots,
        offeringRound: data.offeringRound + 1,
        emailAttempts: 0,
        email,
        stateUpdatedAt: new Date().toISOString(),
      };
      await setSchedule(ctx.conversation.id, "OFFERING", newData);
      const extraction = await generateExtraction({
        tone: ctx.agent.tone,
        leadName: ctx.leadName,
        state: "OFFERING",
        slots: newSlots.map((s) => ({ label: s.label })),
        message: "",
        transferMessage: ctx.agent.transferMessage,
      });
      await sendBotMessage(ctx, extraction.reply);
      return "reply";
    }
    throw err;
  }

  const created = await createEventRobust({
    refreshToken,
    summary: title,
    start: chosen.start,
    end: chosen.end,
    timeZone: env.APP_TIMEZONE,
    attendeeEmail: email,
    requestId: bookingId,
  });

  if ("disconnected" in created) {
    await prisma.booking.update({ where: { id: bookingId }, data: { status: "CANCELLED" } });
    await prisma.calendarConnection.update({
      where: { userId: ctx.userId },
      data: { status: "DISCONNECTED", refreshToken: "", disconnectedAt: new Date() },
    });
    await notify({
      accountId: ctx.accountId,
      type: "CALENDAR_DISCONNECTED",
      level: "ERROR",
      message: "Google Agenda desconectado: reconecte em Configurações.",
    });
    return reofferAfterGoogleFailure(ctx, data, email, "calendar_unavailable");
  }
  if ("retryExhausted" in created) {
    await prisma.booking.update({ where: { id: bookingId }, data: { status: "CANCELLED" } });
    return reofferAfterGoogleFailure(ctx, data, email, "no_slot_accepted");
  }

  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "CONFIRMED", googleEventId: created.eventId, meetLink: created.meetLink ?? null },
  });

  const when = chosen.label;
  const confirmation = await generateConfirmationMessage({
    tone: ctx.agent.tone,
    facts: { when, meetLink: created.meetLink, email, title },
  });
  await sendBotMessage(ctx, confirmation);

  await setSchedule(ctx.conversation.id, "BOOKED", { ...data, bookingId });
  await setSchedule(ctx.conversation.id, "NONE", {});

  await notify({
    accountId: ctx.accountId,
    type: "BOOKING_CONFIRMED",
    message: `Reunião marcada: ${title} (${when})`,
    payload: { bookingId, email: maskEmail(email) },
  });
  await createLog({
    type: "BOOKING_CONFIRMED",
    message: `Reunião marcada ${when} com ${maskEmail(email)}`,
    accountId: ctx.accountId,
    campaignId: ctx.campaignId ?? undefined,
    leadId: ctx.leadId ?? undefined,
    payload: { bookingId, googleEventId: created.eventId },
  });
  return "reply";
}

async function reofferAfterGoogleFailure(
  ctx: SchedulingContext,
  data: ScheduleData,
  email: string,
  transferReason: string,
): Promise<BotAction> {
  const newSlots = await regenerateSlots(ctx);
  if (newSlots.length === 0) return transferScheduling(ctx, transferReason);
  const newData: ScheduleData = {
    slots: newSlots,
    offeringRound: 1,
    emailAttempts: 0,
    email,
    stateUpdatedAt: new Date().toISOString(),
  };
  await setSchedule(ctx.conversation.id, "OFFERING", newData);
  const extraction = await generateExtraction({
    tone: ctx.agent.tone,
    leadName: ctx.leadName,
    state: "OFFERING",
    slots: newSlots.map((s) => ({ label: s.label })),
    message: "",
    transferMessage: ctx.agent.transferMessage,
  });
  await sendBotMessage(ctx, extraction.reply);
  return "reply";
}
