import "dotenv/config";
import { z } from "zod";

function normalizePublicUrl(value: unknown) {
  const fallback = "http://localhost:3000";
  const raw = typeof value === "string" ? value.trim() : "";
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  const railwayStaticUrl = process.env.RAILWAY_STATIC_URL?.trim();

  const candidates = [
    raw,
    railwayStaticUrl,
    railwayDomain,
    fallback
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const normalized = candidate.startsWith("http://") || candidate.startsWith("https://")
      ? candidate
      : `https://${candidate}`;
    try {
      return new URL(normalized).toString().replace(/\/$/, "");
    } catch {
      continue;
    }
  }
  return fallback;
}

function envBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  return value;
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  PUBLIC_GATEWAY_URL: z.preprocess(normalizePublicUrl, z.string().url()),
  ADMIN_API_KEY: z.string().min(12),
  DEVICE_TOKEN_PEPPER: z.string().min(12),
  PAIRING_CODE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  DEVICE_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(3650),
  MAX_VOICE_NOTE_MB: z.coerce.number().int().positive().default(50),
  UPLOAD_DIR: z.string().default("./uploads"),
  DEFAULT_AGENT: z.string().default("hermes"),
  HERMES_BASE_URL: z.string().url().default("http://localhost:8080"),
  HERMES_API_KEY: z.string().optional().default(""),
  HERMES_LOGIN: z.string().optional().default(""),
  HERMES_USERNAME: z.string().optional().default(""),
  HERMES_PASSWORD: z.string().optional().default(""),
  HERMES_LOGIN_PATH: z.string().default("/api/v1/auth/login"),
  HERMES_USERNAME_FIELD: z.string().default("login"),
  HERMES_PASSWORD_FIELD: z.string().default("password"),
  HERMES_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(3300),
  HERMES_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  OPENAI_API_KEY: z.string().optional().default(""),
  STT_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  OPENAI_STT_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  TAILSCALE_ENABLED: z.preprocess(envBoolean, z.boolean()).default(false),
  TAILSCALE_AUTHKEY: z.string().optional().default(""),
  TAILSCALE_HOSTNAME: z.string().default("pocket-gateway-railway"),
  TAILSCALE_STATE_DIR: z.string().default("/var/lib/tailscale"),
  TAILSCALE_EXTRA_ARGS: z.string().optional().default(""),
  TAILSCALE_SOCKS5_ADDR: z.string().optional().default(""),
  OTA_ENABLED: z.preprocess(envBoolean, z.boolean()).default(false),
  OTA_GITHUB_REPO: z.string().default("yokki-vans/pocket-familiar-firmware"),
  OTA_GITHUB_TOKEN: z.string().optional().default(""),
  OTA_MANIFEST_ASSET: z.string().default("pocket-familiar-ota-manifest.json"),
  OTA_FIRMWARE_ASSET: z.string().default("pocket_familiar_os.bin"),
  OTA_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
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
