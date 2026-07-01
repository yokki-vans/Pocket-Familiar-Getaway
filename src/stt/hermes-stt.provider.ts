import fetch, { FormData, fileFromSync, type Response } from "node-fetch";
import { SocksProxyAgent } from "socks-proxy-agent";
import { config } from "../config.js";
import type { SttProvider } from "./stt-provider.js";

type HermesSession = {
  headers: Record<string, string>;
  expiresAt: number;
};

let session: HermesSession | undefined;
let loginPromise: Promise<HermesSession> | undefined;

function agent() {
  if (!config.TAILSCALE_SOCKS5_ADDR) return undefined;
  return new SocksProxyAgent(`socks5://${config.TAILSCALE_SOCKS5_ADDR}`);
}

function loginName() {
  return config.HERMES_LOGIN || config.HERMES_USERNAME;
}

function cookieHeader(response: Response) {
  const raw = response.headers.raw()["set-cookie"] ?? [];
  const cookies = raw.map((cookie: string) => cookie.split(";")[0]).filter(Boolean);
  return cookies.length ? cookies.join("; ") : undefined;
}

async function safeJson(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined;
  try {
    return await response.json() as unknown;
  } catch {
    return undefined;
  }
}

function extractToken(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ["access_token", "accessToken", "token", "jwt"]) {
    if (typeof record[key] === "string" && record[key]) return record[key];
  }
  if (record.data && typeof record.data === "object") return extractToken(record.data);
  if (record.session && typeof record.session === "object") return extractToken(record.session);
  return undefined;
}

function extractExpiresIn(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ["expires_in", "expiresIn", "ttl"]) {
    if (typeof record[key] === "number" && Number.isFinite(record[key])) return record[key];
  }
  if (record.data && typeof record.data === "object") return extractExpiresIn(record.data);
  if (record.session && typeof record.session === "object") return extractExpiresIn(record.session);
  return undefined;
}

async function loginWithPassword(): Promise<HermesSession> {
  const body: Record<string, string> = {
    [config.HERMES_USERNAME_FIELD]: loginName(),
    [config.HERMES_PASSWORD_FIELD]: config.HERMES_PASSWORD
  };
  if (config.HERMES_AUTH_PROVIDER) body.provider = config.HERMES_AUTH_PROVIDER;
  const response = await fetch(new URL(config.HERMES_LOGIN_PATH, config.HERMES_BASE_URL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.min(config.HERMES_TIMEOUT_MS, 10000)),
    agent: agent()
  });
  if (!response.ok) throw new Error(`Hermes STT login failed: ${response.status}`);

  const cookie = cookieHeader(response);
  const data = await safeJson(response);
  const token = extractToken(data);
  const expiresIn = extractExpiresIn(data);
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  else if (cookie) headers.cookie = cookie;
  if (!Object.keys(headers).length) throw new Error("Hermes STT login response did not include auth");

  session = {
    headers,
    expiresAt: Date.now() + Math.max(60, expiresIn ?? config.HERMES_SESSION_TTL_SECONDS) * 1000
  };
  return session;
}

async function authHeaders() {
  if (loginName() && config.HERMES_PASSWORD) {
    const now = Date.now();
    if (session && session.expiresAt > now + 30000) return session.headers;
    loginPromise ??= loginWithPassword().finally(() => {
      loginPromise = undefined;
    });
    return (await loginPromise).headers;
  }
  return config.HERMES_API_KEY ? { authorization: `Bearer ${config.HERMES_API_KEY}` } : {};
}

function extractTranscript(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  for (const key of ["text", "transcript", "transcription"]) {
    if (typeof record[key] === "string") return record[key].trim();
  }
  if (record.result && typeof record.result === "object") return extractTranscript(record.result);
  if (record.data && typeof record.data === "object") return extractTranscript(record.data);
  return "";
}

export class HermesSttProvider implements SttProvider {
  async transcribe(input: { filePath: string; mimeType: string }) {
    const paths = Array.from(new Set([
      config.HERMES_STT_PATH,
      "/api/v1/audio/transcriptions",
      "/v1/audio/transcriptions",
      "/api/audio/transcriptions",
      "/api/transcribe",
      "/transcribe"
    ]));
    const errors: string[] = [];
    for (const path of paths) {
      try {
        return await this.postTranscription(path, input);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    throw new Error(`Hermes transcription failed: ${errors.join("; ")}`);
  }

  private async postTranscription(path: string, input: { filePath: string; mimeType: string }) {
    const form = new FormData();
    form.set("model", config.HERMES_STT_MODEL);
    form.set("file", fileFromSync(input.filePath, input.mimeType));
    const res = await fetch(new URL(path, config.HERMES_BASE_URL), {
      method: "POST",
      headers: await authHeaders(),
      body: form,
      signal: AbortSignal.timeout(config.HERMES_TIMEOUT_MS),
      agent: agent()
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) session = undefined;
      throw new Error(`Hermes transcription failed at ${path}: ${res.status}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return extractTranscript(await res.json());
    }
    return (await res.text()).trim();
  }
}
