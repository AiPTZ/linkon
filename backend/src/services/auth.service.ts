import { prisma } from "../lib/prisma";
import { unipile, type UnipileAccount } from "./unipile.service";
import { configService } from "./config.service";
import { createLog } from "./log.service";
import { encrypt } from "../utils/crypto";
import { env } from "../config/env";
import { ApiError } from "../utils/errors";

export interface NativeAuthResult {
  checkpoint?: string;
  account?: UnipileAccount;
  localAccountId?: string;
}

export async function connectNative(
  username: string,
  password: string,
  country?: string,
  userId?: string | null,
): Promise<NativeAuthResult> {
  const result = await unipile.connectLinkedinNative(username, password, country);

  if (result.checkpoint && result.account_id) {
    const local = await prisma.account.upsert({
      where: { unipileAccountId: result.account_id },
      update: { status: "CHECKPOINT", checkpointType: result.checkpoint.type, username, userId: userId ?? null, credentialsEnc: encrypt(JSON.stringify({ username, password })) },
      create: { unipileAccountId: result.account_id, username, authMethod: "NATIVE", status: "CHECKPOINT", checkpointType: result.checkpoint.type, userId: userId ?? null, credentialsEnc: encrypt(JSON.stringify({ username, password })) },
    });
    return { checkpoint: result.checkpoint.type, localAccountId: local.id };
  }

  const account = result as unknown as UnipileAccount;
  const local = await prisma.account.upsert({
    where: { unipileAccountId: account.id },
    update: { status: "OK", checkpointType: null, username, authMethod: "NATIVE", userId: userId ?? null, credentialsEnc: encrypt(JSON.stringify({ username, password })) },
    create: { unipileAccountId: account.id, username, authMethod: "NATIVE", status: "OK", userId: userId ?? null, credentialsEnc: encrypt(JSON.stringify({ username, password })) },
  });
  return { account, localAccountId: local.id };
}

export async function solveCheckpoint(
  localAccountId: string,
  code: string,
): Promise<NativeAuthResult> {
  const local = await prisma.account.findUnique({ where: { id: localAccountId } });
  if (!local) throw new ApiError(404, "Conta não encontrada");

  const result = await unipile.solveCheckpoint(local.unipileAccountId, code);

  if (result.checkpoint && result.checkpoint.type) {
    await prisma.account.update({
      where: { id: localAccountId },
      data: { checkpointType: result.checkpoint.type },
    });
    return { checkpoint: result.checkpoint.type, localAccountId };
  }

  await prisma.account.update({
    where: { id: localAccountId },
    data: { status: "OK", checkpointType: null },
  });
  await createLog({
    type: "ACCOUNT_CONNECTED",
    message: "Conta LinkedIn conectada com sucesso",
    accountId: localAccountId,
  });
  return { localAccountId };
}

export async function createHostedAuthUrl(userId: string | null): Promise<{ url: string }> {
  const dsn = await configService.unipileDsn();
  if (!dsn) throw new ApiError(503, "Unipile DSN não configurado");

  const apiUrl = dsn.replace(/\/+$/, "");
  const expiresOn = new Date(Date.now() + 10 * 60_000).toISOString();
  const frontendOrigin = env.FRONTEND_ORIGIN;

  const result = await unipile.createHostedAuthLink({
    apiUrl,
    expiresOn,
    successRedirectUrl: `${frontendOrigin}/conectar?hosted=ok`,
    failureRedirectUrl: `${frontendOrigin}/conectar?hosted=error`,
    name: `linkon-connect-${userId ?? "global"}-${Date.now()}`,
  });
  return { url: result.url };
}

export async function confirmHosted(
  userId: string | null,
  opts: { pending: boolean },
): Promise<{ accounts: number }> {
  const { items = [] } = await unipile.listAccounts();
  const prefix = `linkon-connect-${userId ?? "global"}-`;
  const matched = items.filter((a) => typeof a.name === "string" && a.name.startsWith(prefix));
  let created = 0;
  for (const acc of matched) {
    if (userId) {
      const owned = await prisma.account.count({
        where: { userId, status: { not: "REJECTED" } },
      });
      if (owned > 0) continue;
    }
    const status = opts.pending ? "PENDING_LINKEDIN" : "OK";
    await prisma.account.upsert({
      where: { unipileAccountId: acc.id },
      update: { status, username: acc.name, userId: userId ?? null },
      create: { unipileAccountId: acc.id, username: acc.name, status, authMethod: "HOSTED", userId: userId ?? null },
    });
    created += 1;
  }
  return { accounts: created };
}

export async function registerWebhooks(): Promise<{ messagingId?: string; usersId?: string }> {
  const webhookBase =
    (await configService.get("webhookPublicUrl")) || env.WEBHOOK_PUBLIC_URL;
  if (!webhookBase) {
    throw new ApiError(
      400,
      "URL pública do webhook não configurada. Defina WEBHOOK_PUBLIC_URL no .env ou na página de Configurações.",
    );
  }

  const requestUrl = `${webhookBase.replace(/\/+$/, "")}/api/webhooks/unipile`;
  const headers = [{ key: "Unipile-Auth", value: env.UNIPILE_WEBHOOK_SECRET }];
  const existing = await prisma.webhookRegistration.findMany();
  const result: { messagingId?: string; usersId?: string } = {};

  if (!existing.some((w) => w.source === "messaging")) {
    const wh = await unipile.createWebhook({
      requestUrl,
      source: "messaging",
      events: ["message_received"],
      headers,
      name: "Link ON messaging",
    });
    await prisma.webhookRegistration.create({
      data: { unipileWebhookId: wh.webhook_id, source: "messaging", requestUrl },
    });
    result.messagingId = wh.webhook_id;
  }

  if (!existing.some((w) => w.source === "users")) {
    const wh = await unipile.createWebhook({
      requestUrl,
      source: "users",
      events: ["new_relation"],
      headers,
      name: "Link ON users",
    });
    await prisma.webhookRegistration.create({
      data: { unipileWebhookId: wh.webhook_id, source: "users", requestUrl },
    });
    result.usersId = wh.webhook_id;
  }

  return result;
}

export async function syncAccounts(): Promise<void> {
  const { items = [] } = await unipile.listAccounts();
  for (const acc of items) {
    const status = acc.sources?.[0]?.status ?? acc.status ?? "OK";
    const local = await prisma.account.findUnique({ where: { unipileAccountId: acc.id } });
    if (!local) {
      await prisma.account.create({
        data: {
          unipileAccountId: acc.id,
          username: acc.name,
          status,
          authMethod: "HOSTED",
        },
      });
      continue;
    }
    if (local.status === "PENDING_LINKEDIN" || local.status === "REJECTED") continue;
    await prisma.account.update({
      where: { id: local.id },
      data: { status, username: acc.name },
    });
  }
}

export async function disconnectAccount(localAccountId: string): Promise<void> {
  const local = await prisma.account.findUnique({ where: { id: localAccountId } });
  if (!local) throw new ApiError(404, "Conta não encontrada");

  await unipile.deleteAccount(local.unipileAccountId);

  await prisma.$transaction([
    prisma.account.update({
      where: { id: localAccountId },
      data: { status: "DISCONNECTED", checkpointType: null },
    }),
    prisma.campaign.updateMany({
      where: { accountId: localAccountId, status: { in: ["RUNNING", "IMPORTING"] } },
      data: { status: "PAUSED" },
    }),
  ]);
  await createLog({
    type: "ACCOUNT_DISCONNECTED",
    level: "WARN",
    message: `Conta ${local.username ?? local.unipileAccountId} desconectada do LinkedIn`,
    accountId: localAccountId,
  });
}
