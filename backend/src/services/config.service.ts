import { prisma } from "../lib/prisma";
import { env } from "../config/env";

const cache = new Map<string, string>();

export const configService = {
  async get(key: string): Promise<string | null> {
    if (cache.has(key)) return cache.get(key) as string;
    const row = await prisma.appConfig.findUnique({ where: { key } });
    const value = row?.value ?? null;
    if (value) cache.set(key, value);
    return value;
  },

  async set(key: string, value: string): Promise<void> {
    await prisma.appConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    cache.set(key, value);
  },

  async unipileDsn(): Promise<string> {
    return (await this.get("unipileDsn")) || env.UNIPILE_DSN;
  },

  async unipileAccessToken(): Promise<string> {
    return (await this.get("unipileAccessToken")) || env.UNIPILE_ACCESS_TOKEN;
  },
};
