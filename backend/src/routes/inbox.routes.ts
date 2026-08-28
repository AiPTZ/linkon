import { Router } from "express";
import { z } from "zod";
import { resolveScope } from "../utils/scope";
import { listInbox, listMessages, sendHumanMessage, claimConversation } from "../services/inbox.service";
import { ah } from "./handler";

export const inboxRouter = Router();

inboxRouter.get(
  "/",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    res.json(await listInbox(userId ?? ""));
  }),
);

inboxRouter.get(
  "/:id/messages",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    res.json({ items: await listMessages(req.params.id, userId ?? "") });
  }),
);

const sendSchema = z.object({ text: z.string().min(1).max(3000) });

inboxRouter.post(
  "/:id/messages",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    const { text } = sendSchema.parse(req.body);
    res.status(201).json(await sendHumanMessage(req.params.id, userId ?? "", text));
  }),
);

inboxRouter.post(
  "/:id/claim",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    res.json(await claimConversation(req.params.id, userId ?? ""));
  }),
);
