import fetch from "node-fetch";
import { SocksProxyAgent } from "socks-proxy-agent";
import { config } from "../config.js";
import type { AgentAdapter, AgentHealth } from "./agent-adapter.js";
import { normalizeResultCard, offlineAgentCard } from "./result-card.js";

export class HermesAdapter implements AgentAdapter {
  id = "hermes";
  name = "Hermes";

  private agent() {
    if (!config.TAILSCALE_SOCKS5_ADDR) return undefined;
    return new SocksProxyAgent(`socks5://${config.TAILSCALE_SOCKS5_ADDR}`);
  }

  async health(): Promise<AgentHealth> {
    if (!config.HERMES_BASE_URL || !config.HERMES_API_KEY) return { status: "not_configured", configured: false };
    try {
      const res = await fetch(new URL("/health", config.HERMES_BASE_URL), {
        headers: this.headers(),
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
      const res = await fetch(new URL(path, config.HERMES_BASE_URL), {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.HERMES_TIMEOUT_MS),
        agent: this.agent()
      });
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

  private headers(): Record<string, string> {
    return config.HERMES_API_KEY ? { authorization: `Bearer ${config.HERMES_API_KEY}` } : {};
  }
}
