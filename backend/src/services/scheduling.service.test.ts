import { describe, expect, it, vi, beforeEach } from "vitest";
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

vi.mock("../lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    booking: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    calendarConnection: { findUnique: vi.fn(), update: vi.fn() },
    conversation: { update: vi.fn() },
    account: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("./unipile.service", () => ({ unipile: { sendChatMessage: vi.fn() } }));
vi.mock("./log.service", () => ({ createLog: vi.fn() }));
vi.mock("./notification.service", () => ({ notify: vi.fn() }));
vi.mock("./calendar.service", () => ({
  createEventRobust: vi.fn(),
}));
vi.mock("./ai.service", () => ({
  generateExtraction: vi.fn(),
  generateConfirmationMessage: vi.fn(),
}));
vi.mock("../utils/crypto", () => ({
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => (s.startsWith("enc:") ? s.slice(4) : s)),
}));
vi.mock("./chatbot-ai.service", () => ({
  recordMessage: vi.fn(),
  transferToHuman: vi.fn(),
}));

import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { createEventRobust } from "./calendar.service";
import { generateExtraction, generateConfirmationMessage } from "./ai.service";
import { recordMessage, transferToHuman } from "./chatbot-ai.service";
import { startBooking, advanceScheduling, maskEmail, type SchedulingContext } from "./scheduling.service";

beforeEach(() => {
  vi.clearAllMocks();
  (transferToHuman as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (recordMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (unipile.sendChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ message_id: "M0" });
});

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

const base: SchedulingContext = {
  userId: "U1",
  conversation: { id: "CONV1", scheduleState: "NONE", scheduleData: "{}", unipileChatId: "CHAT1" },
  accountId: "A1",
  leadId: "L1",
  campaignId: null,
  leadName: "João",
  agent: {
    schedulingEnabled: true,
    meetingDurationMin: 30,
    meetingTitle: "",
    tone: "consultivo",
    transferMessage: "Vou transferir.",
  },
  productName: "LinkON",
};

describe("maskEmail", () => {
  it("mascara o usuário do e-mail", () => {
    expect(maskEmail("joaopedro@x.com")).toBe("j***@x.com");
  });
});

describe("startBooking", () => {
  it("transfere quando o calendário está desconectado", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      calendarConnection: { status: "DISCONNECTED" },
      sellerAvailability: { windows: "[]" },
    });
    const action = await startBooking(base);
    expect(action).toBe("transfer");
    expect(prisma.conversation.update).toHaveBeenCalled();
  });

  it("gera slots e envia oferta quando conectado", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      calendarConnection: { status: "CONNECTED" },
      sellerAvailability: { windows: JSON.stringify([{ weekday: 1, startMin: 540, endMin: 1080 }]) },
    });
    (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (generateExtraction as ReturnType<typeof vi.fn>).mockResolvedValue({
      reply: "Tenho essas opções: 1. seg às 14:00...",
      extracted: {},
      tokensIn: 10,
      tokensOut: 20,
    });
    (unipile.sendChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ message_id: "M1" });
    const action = await startBooking(base);
    expect(action).toBe("reply");
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scheduleState: "OFFERING" }) }),
    );
  });
});

describe("advanceScheduling", () => {
  it("vai para AWAITING_EMAIL quando o lead escolhe um slot", async () => {
    const data = {
      slots: [
        { start: "2026-09-01T17:00:00.000Z", end: "2026-09-01T17:30:00.000Z", label: "seg., 01/09 às 14:00" },
      ],
      offeringRound: 1,
      emailAttempts: 0,
      email: null,
    };
    const ctx = { ...base, conversation: { ...base.conversation, scheduleState: "OFFERING", scheduleData: JSON.stringify(data) } };
    (generateExtraction as ReturnType<typeof vi.fn>).mockResolvedValue({
      reply: "Perfeito! Qual seu e-mail?",
      extracted: { chosenSlotIndex: 1 },
      tokensIn: 10,
      tokensOut: 20,
    });
    (unipile.sendChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ message_id: "M2" });
    const action = await advanceScheduling({ ...ctx, message: "o primeiro" });
    expect(action).toBe("reply");
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scheduleState: "AWAITING_EMAIL" }) }),
    );
  });

  it("reoferece outros horários e transfere após 3 rodadas", async () => {
    const data = {
      slots: [{ start: "a", end: "b", label: "seg., 01/09 às 14:00" }],
      offeringRound: 3,
      emailAttempts: 0,
      email: null,
    };
    const ctx = { ...base, conversation: { ...base.conversation, scheduleState: "OFFERING", scheduleData: JSON.stringify(data) } };
    (generateExtraction as ReturnType<typeof vi.fn>).mockResolvedValue({
      reply: "Entendi, deixa eu ver outros.",
      extracted: { wantsOtherTimes: true },
      tokensIn: 10,
      tokensOut: 20,
    });
    (unipile.sendChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ message_id: "M3" });
    const action = await advanceScheduling({ ...ctx, message: "tem 7h?" });
    expect(action).toBe("transfer");
  });

  it("confirma booking com evento Google e Meet", async () => {
    const data = {
      slots: [
        { start: "2026-09-01T17:00:00.000Z", end: "2026-09-01T17:30:00.000Z", label: "seg., 01/09 às 14:00" },
      ],
      offeringRound: 1,
      emailAttempts: 0,
      email: "joao@x.com",
      chosenSlot: { start: "2026-09-01T17:00:00.000Z", end: "2026-09-01T17:30:00.000Z", label: "seg., 01/09 às 14:00" },
    };
    const ctx = {
      ...base,
      conversation: { ...base.conversation, scheduleState: "AWAITING_EMAIL", scheduleData: JSON.stringify(data) },
    };
    (prisma.calendarConnection.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "CONNECTED",
      refreshToken: "enc:abc",
    });
    (generateExtraction as ReturnType<typeof vi.fn>).mockResolvedValue({
      reply: "Qual seu e-mail?",
      extracted: {},
      tokensIn: 10,
      tokensOut: 20,
    });
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
      cb(prisma),
    );
    (prisma.booking.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "B1" });
    (createEventRobust as ReturnType<typeof vi.fn>).mockResolvedValue({
      eventId: "EV1",
      meetLink: "https://meet.google.com/abc",
    });
    (prisma.booking.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (generateConfirmationMessage as ReturnType<typeof vi.fn>).mockResolvedValue("Confirmado! seg., 01/09 às 14:00, Meet: https://meet.google.com/abc, convite para joao@x.com");
    (unipile.sendChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ message_id: "M4" });
    const action = await advanceScheduling({ ...ctx, message: "meu email é joao@x.com" });
    expect(action).toBe("reply");
    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CONFIRMED", googleEventId: "EV1" }) }),
    );
  });
});
