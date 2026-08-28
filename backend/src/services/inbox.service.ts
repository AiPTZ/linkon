import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { ApiError } from "../utils/errors";
import type { ConversationMessage } from "@prisma/client";

interface InboxItem {
  id: string;
  status: string;
  lastMessageAt: Date;
  lead: { name: string | null; headline: string | null; profileUrl: string | null };
  campaign: { id: string; name: string; mode: string };
  lastMessage: string | null;
  unread: number;
}

export async function listInbox(userId: string | null): Promise<{
  items: InboxItem[];
  needsHuman: number;
}> {
  const [conversations, needsHuman] = await Promise.all([
    prisma.conversation.findMany({
      where: { campaign: { userId } },
      orderBy: [{ status: "asc" }, { lastMessageAt: "desc" }],
      include: {
        lead: { select: { name: true, headline: true, profileUrl: true } },
        campaign: { select: { id: true, name: true, mode: true } },
      },
    }),
    prisma.conversation.count({ where: { campaign: { userId }, status: "NEEDS_HUMAN" } }),
  ]);

  const items: InboxItem[] = [];
  for (const c of conversations) {
    const last = await prisma.conversationMessage.findFirst({
      where: { conversationId: c.id },
      orderBy: { createdAt: "desc" },
      select: { content: true, role: true },
    });
    const unread = await prisma.conversationMessage.count({
      where: { conversationId: c.id, role: "LEAD", createdAt: { gt: c.updatedAt } },
    });
    items.push({
      id: c.id,
      status: c.status,
      lastMessageAt: c.lastMessageAt,
      lead: c.lead,
      campaign: c.campaign,
      lastMessage: last?.content ?? null,
      unread,
    });
  }
  return { items, needsHuman };
}

async function assertAccess(conversationId: string, userId: string | null) {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, campaign: { userId } },
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
