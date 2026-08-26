import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().default("file:./dev.db"),
  UNIPILE_DSN: z.string().optional().default(""),
  UNIPILE_ACCESS_TOKEN: z.string().optional().default(""),
  UNIPILE_WEBHOOK_SECRET: z.string().min(8).default("linkon-webhook-secret-change-me"),
  WEBHOOK_PUBLIC_URL: z.string().optional().default(""),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  APP_TIMEZONE: z.string().default("America/Sao_Paulo"),
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(16).default("dev-encryption-key-change-me"),
  FRONTEND_ORIGIN: z.string().default("http://localhost:5173"),
  AUTH_SECRET: z.string().min(16).default("linkon-auth-secret-change-me"),
  ADMIN_USERNAME: z.string().min(1).default("admin"),
  ADMIN_PASSWORD: z.string().min(6).default("admin"),
  WHATSAPP_SUPPORT: z.string().min(8).default("5519990041826"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
