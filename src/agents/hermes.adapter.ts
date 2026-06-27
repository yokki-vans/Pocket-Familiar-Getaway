import fetch, { type Response } from "node-fetch";
import { SocksProxyAgent } from "socks-proxy-agent";
import WebSocket from "ws";
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
    return this.sendViaDashboard(input.text, input);
  }

  async sendVoiceNote(input: { noteId: string; transcript?: string; filePath?: string; deviceId: string; sessionId: string; context?: Record<string, unknown> }) {
    const text = input.transcript?.trim() || `Voice note ${input.noteId}`;
    return this.sendViaDashboard(text, input);
  }

  private async sendViaDashboard(text: string, payload: Record<string, unknown>) {
    const health = await this.health();
    if (health.status !== "online") return offlineAgentCard(this.id);
    try {
      const body = await this.runDashboardChat(text, payload);
      return normalizeResultCard({
        kind: "answer",
        title: "Hermes",
        body,
        status: "done",
        agent: this.id,
        actions: [{ id: "done", label: "Done" }]
      });
    } catch {
      return offlineAgentCard(this.id);
    }
  }

  private async runDashboardChat(text: string, payload: Record<string, unknown>, retried = false): Promise<string> {
    const session = await this.login();
    const ticketRes = await fetch(new URL("/api/auth/ws-ticket", config.HERMES_BASE_URL), {
      method: "POST",
      headers: session.headers,
      signal: AbortSignal.timeout(Math.min(config.HERMES_TIMEOUT_MS, 10000)),
      agent: this.agent()
    });
    if (ticketRes.status === 401 || ticketRes.status === 403) {
      this.session = undefined;
      if (!retried) return this.runDashboardChat(text, payload, true);
    }
    if (!ticketRes.ok) throw new Error(`Hermes ws ticket failed: ${ticketRes.status}`);
    const ticketData = await ticketRes.json() as { ticket?: string };
    if (!ticketData.ticket) throw new Error("Hermes ws ticket missing");

    const base = new URL(config.HERMES_BASE_URL);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = "/api/pty";
    base.search = new URLSearchParams({
      ticket: ticketData.ticket,
      fresh: "1",
      channel: `pocket-${String(payload.sessionId ?? Date.now())}`
    }).toString();

    return new Promise<string>((resolve, reject) => {
      const chunks: string[] = [];
      let sent = false;
      let settled = false;
      let lastDataAt = Date.now();
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearInterval(quietTimer);
        clearTimeout(hardTimer);
        try { ws.close(); } catch {}
        if (err) reject(err);
        else resolve(this.extractDashboardAnswer(chunks.join(""), text));
      };
      const ws = new WebSocket(base.toString(), { agent: this.agent() });
      const hardTimer = setTimeout(() => settle(new Error("Hermes dashboard timeout")), config.HERMES_TIMEOUT_MS);
      const quietTimer = setInterval(() => {
        if (sent && Date.now() - lastDataAt > 5500) settle();
      }, 1000);

      ws.on("open", () => {
        ws.send("\x1b[RESIZE:96;32]");
        setTimeout(() => {
          sent = true;
          ws.send(`${text.trim()}\r`);
        }, 1200);
      });
      ws.on("message", (data) => {
        lastDataAt = Date.now();
        chunks.push(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
      });
      ws.on("error", (err) => settle(err instanceof Error ? err : new Error(String(err))));
      ws.on("close", () => {
        if (sent && chunks.length) settle();
        else settle(new Error("Hermes dashboard closed"));
      });
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

  private extractDashboardAnswer(output: string, prompt: string) {
    const clean = output
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.includes(prompt.trim()))
      .filter((line) => !/^[-╭╰│╎─]+$/.test(line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!clean) return "Hermes accepted the request, but did not return a readable response.";
    return clean.slice(-1600);
  }
}
