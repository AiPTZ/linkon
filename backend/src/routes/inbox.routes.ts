import { Router } from "express";
import { z } from "zod";
import { resolveScope } from "../utils/scope";
import { listInbox, listMessages, sendHumanMessage, claimConversation, reactivateConversation, markConversationRead, updateConversation } from "../services/inbox.service";
import { ah } from "./handler";

export const inboxRouter = Router();

inboxRouter.get(
  "/",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    const offset = Number(req.query.offset ?? 0);
    const limit = Number(req.query.limit ?? 50);
    res.json(
      await listInbox(userId, {
        offset: Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0,
        limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50,
      }),
    );
  }),
);

inboxRouter.get(
  "/:id/messages",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    const cursor = typeof req.query.cursor === "string" && req.query.cursor ? req.query.cursor : undefined;
    const limit = Number(req.query.limit ?? 50);
    res.json(
      await listMessages(req.params.id, userId, {
        cursor,
        limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50,
      }),
    );
  }),
);

const sendSchema = z.object({ text: z.string().min(1).max(3000) });

inboxRouter.post(
  "/:id/messages",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    const { text } = sendSchema.parse(req.body);
    res.status(201).json(await sendHumanMessage(req.params.id, userId, text));
  }),
);

inboxRouter.post(
  "/:id/claim",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    res.json(await claimConversation(req.params.id, userId));
  }),
);

inboxRouter.post(
  "/:id/reactivate",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    res.json(await reactivateConversation(req.params.id, userId));
  }),
);

inboxRouter.post(
  "/:id/read",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    await markConversationRead(req.params.id, userId);
    res.status(204).end();
  }),
);

const patchSchema = z.object({ note: z.string().max(2000).optional(), resolved: z.boolean().optional() });

inboxRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    const body = patchSchema.parse(req.body);
    res.json(await updateConversation(req.params.id, userId, body));
  }),
);
