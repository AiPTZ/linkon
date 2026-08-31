import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { ApiError } from "../utils/errors";
import { generateHumanReply, parseKnowledgeBase, estimateCost } from "./ai.service";
import type { ConversationMessage } from "@prisma/client";

interface InboxItem {
  id: string;
  status: string;
  note: string;
  resolved: boolean;
  lastMessageAt: Date;
  lead: { name: string | null; headline: string | null; profileUrl: string | null } | null;
  campaign: { id: string; name: string; mode: string } | null;
  account: { username: string | null };
  lastMessage: string | null;
  unread: number;
  booking: { startTime: Date; meetLink: string | null } | null;
}

export async function listInbox(
  userId: string | null,
  opts: { offset?: number; limit?: number } = {},
): Promise<{ items: InboxItem[]; needsHuman: number; total: number; hasMore: boolean }> {
  const offset = Math.max(opts.offset ?? 0, 0);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const where = { account: { userId } };
  const [conversations, needsHuman, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: [{ status: "asc" }, { lastMessageAt: "desc" }],
      skip: offset,
      take: limit,
      include: {
        lead: { select: { name: true, headline: true, profileUrl: true } },
        campaign: { select: { id: true, name: true, mode: true } },
        account: { select: { username: true } },
        bookings: {
          where: { status: "CONFIRMED" },
          select: { startTime: true, meetLink: true },
          orderBy: { startTime: "asc" },
          take: 1,
        },
      },
    }),
    prisma.conversation.count({ where: { account: { userId }, status: "NEEDS_HUMAN" } }),
    prisma.conversation.count({ where }),
  ]);

  const items: InboxItem[] = [];
  for (const c of conversations) {
    items.push(await itemFromRow(c));
  }
  const hasMore = offset + items.length < total;
  return { items, needsHuman, total, hasMore };
}

async function itemFromRow(c: {
  id: string;
  status: string;
  note: string;
  resolved: boolean;
  updatedAt: Date;
  lastMessageAt: Date;
  lead: { name: string | null; headline: string | null; profileUrl: string | null } | null;
  campaign: { id: string; name: string; mode: string } | null;
  account: { username: string | null };
  bookings: { startTime: Date; meetLink: string | null }[];
}): Promise<InboxItem> {
  const last = await prisma.conversationMessage.findFirst({
    where: { conversationId: c.id },
    orderBy: { createdAt: "desc" },
    select: { content: true, role: true },
  });
  const unread = await prisma.conversationMessage.count({
    where: { conversationId: c.id, role: "LEAD", createdAt: { gt: c.updatedAt } },
  });
  return {
    id: c.id,
    status: c.status,
    note: c.note,
    resolved: c.resolved,
    lastMessageAt: c.lastMessageAt,
    lead: c.lead,
    campaign: c.campaign,
    account: c.account,
    lastMessage: last?.content ?? null,
    unread,
    booking: c.bookings?.[0] ?? null,
  };
}

async function assertAccess(conversationId: string, userId: string | null) {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, account: { userId } },
  });
  if (!conv) throw new ApiError(404, "Conversa não encontrada");
  return conv;
}

export async function listMessages(
  conversationId: string,
  userId: string | null,
  opts: { cursor?: string; limit?: number } = {},
): Promise<{ items: ConversationMessage[]; nextCursor: string | null }> {
  await assertAccess(conversationId, userId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const where = { conversationId };
  const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  let rows: ConversationMessage[];
  if (opts.cursor) {
    rows = await prisma.conversationMessage.findMany({
      where,
      orderBy,
      cursor: { id: opts.cursor },
      skip: 1,
      take: limit,
    });
  } else {
    rows = await prisma.conversationMessage.findMany({ where, orderBy, take: limit });
  }
  rows.reverse();
  const total = await prisma.conversationMessage.count({ where: { conversationId } });
  const hasMore = opts.cursor ? rows.length === limit : total > limit;
  return { items: rows, nextCursor: hasMore && rows.length > 0 ? rows[0].id : null };
}

export async function sendHumanMessage(
  conversationId: string,
  userId: string | null,
  text: string,
): Promise<ConversationMessage> {
  const conv = await assertAccess(conversationId, userId);
  const res = await unipile.sendChatMessage(conv.unipileChatId, text);
  const msg = await prisma.conversationMessage.create({
    data: {
      conversationId,
      role: "HUMAN",
      content: text.slice(0, 4000),
      messageId: res.message_id,
    },
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "HUMAN", lastMessageAt: new Date() },
  });
  return msg;
}

export async function claimConversation(conversationId: string, userId: string | null): Promise<{ ok: boolean }> {
  await assertAccess(conversationId, userId);
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "HUMAN" },
  });
  return { ok: true };
}

export async function reactivateConversation(
  conversationId: string,
  userId: string | null,
): Promise<{ ok: boolean }> {
  await assertAccess(conversationId, userId);
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "BOT" },
  });
  return { ok: true };
}

export async function markConversationRead(
  conversationId: string,
  userId: string | null,
): Promise<{ ok: boolean }> {
  await assertAccess(conversationId, userId);
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
  return { ok: true };
}

export async function updateConversation(
  conversationId: string,
  userId: string | null,
  patch: { note?: string; resolved?: boolean },
): Promise<InboxItem> {
  await assertAccess(conversationId, userId);
  const data: { note?: string; resolved?: boolean } = {};
  if (patch.note !== undefined) data.note = patch.note;
  if (patch.resolved !== undefined) data.resolved = patch.resolved;
  await prisma.conversation.update({ where: { id: conversationId }, data });
  const c = await prisma.conversation.findFirst({
    where: { id: conversationId },
    include: {
      lead: { select: { name: true, headline: true, profileUrl: true } },
      campaign: { select: { id: true, name: true, mode: true } },
      account: { select: { username: true } },
      bookings: {
        where: { status: "CONFIRMED" },
        select: { startTime: true, meetLink: true },
        orderBy: { startTime: "asc" },
        take: 1,
      },
    },
  });
  if (!c) throw new ApiError(404, "Conversa não encontrada");
  return itemFromRow({
    ...c,
    note: data.note ?? c.note,
    resolved: data.resolved ?? c.resolved,
  });
}

export async function suggestReply(
  conversationId: string,
  userId: string | null,
  text?: string,
): Promise<{ reply: string; costUsd: number }> {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, account: { userId } },
    include: {
      lead: { select: { name: true, headline: true } },
      account: { include: { nativeAgent: true } },
    },
  });
  if (!conv) throw new ApiError(404, "Conversa não encontrada");
  const agent = conv.account.nativeAgent;
  const kb = parseKnowledgeBase(agent?.knowledgeBase ?? "");
  const historyRows = await prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 8,
  });
  const history = historyRows
    .filter((m) => m.role === "LEAD" || m.role === "BOT")
    .map((m) => ({ role: (m.role === "LEAD" ? "lead" : "bot") as "lead" | "bot", content: m.content }));
  const lastLead = historyRows.filter((m) => m.role === "LEAD").pop();
  const message = text?.trim() || lastLead?.content || "";
  if (!message) throw new ApiError(400, "Nenhuma mensagem para responder");
  const out = await generateHumanReply({
    productName: kb.product || "produto",
    knowledgeBase: kb,
    tone: agent?.tone || "consultivo e profissional",
    leadName: conv.lead?.name ?? null,
    leadHeadline: conv.lead?.headline ?? null,
    history,
    message,
  });
  return { reply: out.reply, costUsd: estimateCost(out.tokensIn, out.tokensOut) };
}
