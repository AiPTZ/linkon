import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { encrypt } from "../utils/crypto";
import { ApiError } from "../utils/errors";
import { resolveScope } from "../utils/scope";
import { buildOAuthUrl, exchangeCodeForTokens } from "../services/calendar.service";
import { parseWindowsInput } from "../services/scheduling.service";
import { ah } from "./handler";

export const calendarRouter = Router();

function oauthConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
}

calendarRouter.get(
  "/status",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    const conn = await prisma.calendarConnection.findUnique({ where: { userId: userId ?? "none" } });
    res.json({
      connected: conn?.status === "CONNECTED",
      googleEmail: conn?.googleEmail ?? "",
      disconnectedAt: conn?.disconnectedAt ?? null,
    });
  }),
);

calendarRouter.get(
  "/oauth/url",
  ah(async (req, res) => {
    if (!oauthConfigured()) {
      throw new ApiError(500, "Google Agenda não configurado no servidor.");
    }
    const { userId } = resolveScope(req);
    if (!userId) throw new ApiError(400, "Usuário necessário para conectar o calendário");
    const state = jwt.sign({ sub: userId }, env.AUTH_SECRET, { expiresIn: "10m" });
    res.json({ url: buildOAuthUrl(state) });
  }),
);

const windowsSchema = z.array(
  z.object({
    weekday: z.number().int().min(0).max(6),
    startMin: z.number().int().min(0).max(1439),
    endMin: z.number().int().min(1).max(1440),
  }),
);

calendarRouter.put(
  "/availability",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    if (!userId) throw new ApiError(400, "Usuário necessário");
    const body = windowsSchema.safeParse(req.body);
    if (!body.success) throw new ApiError(400, "Janelas inválidas");
    const windows = parseWindowsInput(body.data);
    await prisma.sellerAvailability.upsert({
      where: { userId },
      update: { windows: JSON.stringify(windows) },
      create: { userId, windows: JSON.stringify(windows) },
    });
    res.json({ windows });
  }),
);

calendarRouter.get(
  "/availability",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    const avail = await prisma.sellerAvailability.findUnique({ where: { userId: userId ?? "none" } });
    let windows: unknown[] = [];
    try {
      windows = JSON.parse(avail?.windows ?? "[]");
    } catch {
      windows = [];
    }
    res.json({ windows });
  }),
);

calendarRouter.post(
  "/disconnect",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    if (userId) {
      await prisma.calendarConnection.update({
        where: { userId },
        data: { status: "DISCONNECTED", refreshToken: "", disconnectedAt: new Date() },
      });
    }
    res.status(204).end();
  }),
);

const bookingsQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

calendarRouter.get(
  "/bookings",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    const q = bookingsQuery.parse(req.query);
    const items = await prisma.booking.findMany({
      where: {
        userId: userId ?? "none",
        status: "CONFIRMED",
        startTime: {
          gte: q.from ? new Date(q.from) : new Date(),
          lte: q.to ? new Date(q.to) : undefined,
        },
      },
      orderBy: { startTime: "asc" },
      take: 100,
    });
    res.json({
      items: items.map((b) => ({
        id: b.id,
        startTime: b.startTime,
        endTime: b.endTime,
        title: b.title,
        meetLink: b.meetLink,
        leadEmail: b.leadEmail,
        leadName: b.leadName,
      })),
    });
  }),
);

export async function handleOAuthCallback(code: unknown, state: unknown) {
  if (!oauthConfigured()) throw new ApiError(500, "Google Agenda não configurado no servidor.");
  if (typeof code !== "string" || typeof state !== "string") {
    throw new ApiError(400, "Parâmetros inválidos");
  }
  let payload: { sub?: string };
  try {
    payload = jwt.verify(state, env.AUTH_SECRET) as { sub?: string };
  } catch {
    throw new ApiError(400, "state inválido ou expirado");
  }
  if (!payload.sub) throw new ApiError(400, "state inválido");
  const { refreshToken, email } = await exchangeCodeForTokens(code);
  await prisma.calendarConnection.upsert({
    where: { userId: payload.sub },
    update: {
      refreshToken: encrypt(refreshToken),
      googleEmail: email,
      status: "CONNECTED",
      disconnectedAt: null,
    },
    create: {
      userId: payload.sub,
      refreshToken: encrypt(refreshToken),
      googleEmail: email,
      status: "CONNECTED",
    },
  });
  return `${env.FRONTEND_ORIGIN}/configuracoes?calendar=connected`;
}
