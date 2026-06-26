import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  PUBLIC_GATEWAY_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_API_KEY: z.string().min(12),
  DEVICE_TOKEN_PEPPER: z.string().min(12),
  PAIRING_CODE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  DEVICE_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(3650),
  MAX_VOICE_NOTE_MB: z.coerce.number().int().positive().default(50),
  UPLOAD_DIR: z.string().default("./uploads"),
  DEFAULT_AGENT: z.string().default("hermes"),
  HERMES_BASE_URL: z.string().url().default("http://localhost:8080"),
  HERMES_API_KEY: z.string().optional().default(""),
  HERMES_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  OPENAI_API_KEY: z.string().optional().default(""),
  STT_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  OPENAI_STT_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  TAILSCALE_ENABLED: z.coerce.boolean().default(false),
  TAILSCALE_AUTHKEY: z.string().optional().default(""),
  TAILSCALE_HOSTNAME: z.string().default("pocket-gateway-railway"),
  TAILSCALE_STATE_DIR: z.string().default("/var/lib/tailscale"),
  TAILSCALE_EXTRA_ARGS: z.string().optional().default(""),
  TAILSCALE_SOCKS5_ADDR: z.string().optional().default(""),
  LOG_LEVEL: z.string().default("info")
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid configuration: ${details}`);
}

export const config = {
  ...parsed.data,
  serviceName: "pocket-gateway",
  version: "0.1.0",
  maxVoiceNoteBytes: parsed.data.MAX_VOICE_NOTE_MB * 1024 * 1024
};
