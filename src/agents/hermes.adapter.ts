import fetch, { type Response } from "node-fetch";
import { SocksProxyAgent } from "socks-proxy-agent";
import { config } from "../config.js";
import type { AgentAdapter, AgentHealth } from "./agent-adapter.js";
import { normalizeResultCard, offlineAgentCard } from "./result-card.js";

type HermesSession = {
  headers: Record<string, string>;
  expiresAt: number;
};

export class HermesAdapter implements AgentAdapter {
  id = "hermes";
  name = "Hermes";
  private session?: HermesSession;
  private loginPromise?: Promise<HermesSession>;

  private agent() {
    if (!config.TAILSCALE_SOCKS5_ADDR) return undefined;
    return new SocksProxyAgent(`socks5://${config.TAILSCALE_SOCKS5_ADDR}`);
  }

  async health(): Promise<AgentHealth> {
    if (!this.configured()) return { status: "not_configured", configured: false };
    try {
      const headers = await this.authHeaders();
      const res = await fetch(new URL(config.HERMES_HEALTH_PATH, config.HERMES_BASE_URL), {
        headers,
        signal: AbortSignal.timeout(Math.min(config.HERMES_TIMEOUT_MS, 5000)),
        agent: this.agent()
      });
      return { status: res.ok ? "online" : "offline", configured: true };
    } catch {
      return { status: "offline", configured: true };
    }
  }

  async sendTextCommand(input: { text: string; deviceId: string; sessionId: string; context?: Record<string, unknown> }) {
    return this.postCommand("/api/v1/command/text", input);
  }

  async sendVoiceNote(input: { noteId: string; transcript?: string; filePath?: string; deviceId: string; sessionId: string; context?: Record<string, unknown> }) {
    return this.postCommand("/api/v1/voice-note", input);
  }

  private async postCommand(path: string, payload: Record<string, unknown>) {
    const health = await this.health();
    if (health.status !== "online") return offlineAgentCard(this.id);
    try {
      let res = await this.postAuthenticated(path, payload);
      if (res.status === 401 || res.status === 403) {
        this.session = undefined;
        res = await this.postAuthenticated(path, payload);
      }
      if (!res.ok) return offlineAgentCard(this.id);
      const data = await res.json() as Record<string, unknown>;
      const result = typeof data.result === "object" && data.result ? data.result as Record<string, unknown> : data;
      return normalizeResultCard({
        kind: result.kind as never,
        title: String(result.title ?? "Sent to Hermes"),
        body: String(result.body ?? result.message ?? "Your request was sent to Hermes."),
        status: result.status ? String(result.status) : "queued",
        agent: this.id,
        priority: result.priority as never,
        actions: Array.isArray(result.actions) ? result.actions as never : [{ id: "done", label: "Done" }]
      });
    } catch {
      return offlineAgentCard(this.id);
    }
  }

  private async postAuthenticated(path: string, payload: Record<string, unknown>) {
    return fetch(new URL(path, config.HERMES_BASE_URL), {
      method: "POST",
      headers: { ...(await this.authHeaders()), "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.HERMES_TIMEOUT_MS),
      agent: this.agent()
    });
  }

  private configured() {
    return Boolean(config.HERMES_BASE_URL && ((this.loginName() && config.HERMES_PASSWORD) || config.HERMES_API_KEY));
  }

  private async authHeaders() {
    if (this.loginName() && config.HERMES_PASSWORD) return (await this.login()).headers;
    return config.HERMES_API_KEY ? { authorization: `Bearer ${config.HERMES_API_KEY}` } : {};
  }

  private loginName() {
    return config.HERMES_LOGIN || config.HERMES_USERNAME;
  }

  private async login() {
    const now = Date.now();
    if (this.session && this.session.expiresAt > now + 30000) return this.session;
    this.loginPromise ??= this.loginWithPassword().finally(() => {
      this.loginPromise = undefined;
    });
    return this.loginPromise;
  }

  private async loginWithPassword(): Promise<HermesSession> {
    const body: Record<string, string> = {
      [config.HERMES_USERNAME_FIELD]: this.loginName(),
      [config.HERMES_PASSWORD_FIELD]: config.HERMES_PASSWORD
    };
    if (config.HERMES_AUTH_PROVIDER) body.provider = config.HERMES_AUTH_PROVIDER;
    const response = await fetch(new URL(config.HERMES_LOGIN_PATH, config.HERMES_BASE_URL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.min(config.HERMES_TIMEOUT_MS, 10000)),
      agent: this.agent()
    });
    if (!response.ok) throw new Error(`Hermes login failed: ${response.status}`);

    const cookie = this.cookieHeader(response);
    const data = await this.safeJson(response);
    const token = this.extractToken(data);
    const expiresIn = this.extractExpiresIn(data);
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    else if (cookie) headers.cookie = cookie;
    if (!Object.keys(headers).length) throw new Error("Hermes login response did not include a token or session cookie");

    const session = {
      headers,
      expiresAt: Date.now() + Math.max(60, expiresIn ?? config.HERMES_SESSION_TTL_SECONDS) * 1000
    };
    this.session = session;
    return session;
  }

  private async safeJson(response: Response) {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return undefined;
    try {
      return await response.json() as unknown;
    } catch {
      return undefined;
    }
  }

  private cookieHeader(response: Response) {
    const raw = response.headers.raw()["set-cookie"] ?? [];
    const cookies = raw.map((cookie: string) => cookie.split(";")[0]).filter(Boolean);
    return cookies.length ? cookies.join("; ") : undefined;
  }

  private extractToken(data: unknown): string | undefined {
    if (!data || typeof data !== "object") return undefined;
    const record = data as Record<string, unknown>;
    for (const key of ["access_token", "accessToken", "token", "jwt"]) {
      if (typeof record[key] === "string" && record[key]) return record[key];
    }
    if (record.data && typeof record.data === "object") return this.extractToken(record.data);
    if (record.session && typeof record.session === "object") return this.extractToken(record.session);
    return undefined;
  }

  private extractExpiresIn(data: unknown): number | undefined {
    if (!data || typeof data !== "object") return undefined;
    const record = data as Record<string, unknown>;
    for (const key of ["expires_in", "expiresIn", "ttl"]) {
      if (typeof record[key] === "number" && Number.isFinite(record[key])) return record[key];
    }
    if (record.data && typeof record.data === "object") return this.extractExpiresIn(record.data);
    if (record.session && typeof record.session === "object") return this.extractExpiresIn(record.session);
    return undefined;
  }
}
