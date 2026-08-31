import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().default("file:./dev.db"),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  UNIPILE_DSN: z.string().optional().default(""),
  UNIPILE_ACCESS_TOKEN: z.string().optional().default(""),
  UNIPILE_WEBHOOK_SECRET: z.string().min(8).default("linkon-webhook-secret-change-me"),
  WEBHOOK_PUBLIC_URL: z.string().optional().default(""),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  APP_TIMEZONE: z.string().default("America/Sao_Paulo"),
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(16).default("dev-encryption-key-change-me"),
  FRONTEND_ORIGIN: z.string().default("http://localhost:5173"),
  CORS_ORIGINS: z.string().default(""),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z.string().default(""),
  AUTH_SECRET: z.string().min(16).default("linkon-auth-secret-change-me"),
  ADMIN_USERNAME: z.string().min(1).default("admin"),
  ADMIN_PASSWORD: z.string().min(6).default("admin"),
  WHATSAPP_SUPPORT: z.string().min(8).default("5519990041826"),
  USER_LLM_API_KEY: z.string().optional().default(""),
  USER_LLM_BASE_URL: z.string().default("https://api.openai.com/v1"),
  USER_LLM_MODEL: z.string().default("gpt-4o-mini"),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_API_MAX: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_WEBHOOK_MAX: z.coerce.number().int().positive().default(600),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
