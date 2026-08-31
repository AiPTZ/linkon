import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { ApiError } from "../utils/errors";
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

export async function listInbox(userId: string | null): Promise<{
  items: InboxItem[];
  needsHuman: number;
}> {
  const [conversations, needsHuman] = await Promise.all([
    prisma.conversation.findMany({
      where: { account: { userId } },
      orderBy: [{ status: "asc" }, { lastMessageAt: "desc" }],
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
  ]);

  const items: InboxItem[] = [];
  for (const c of conversations) {
    items.push(await itemFromRow(c));
  }
  return { items, needsHuman };
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

export async function listMessages(conversationId: string, userId: string | null): Promise<ConversationMessage[]> {
  await assertAccess(conversationId, userId);
  return prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
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
