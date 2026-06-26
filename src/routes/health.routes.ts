import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { listAgents } from "../agents/agent-registry.js";

const execFileAsync = promisify(execFile);

async function tailscaleStatus() {
  if (!config.TAILSCALE_ENABLED) return { enabled: false, status: "disabled" };
  try {
    const { stdout } = await execFileAsync("tailscale", ["--socket=/tmp/tailscaled.sock", "status", "--json"], { timeout: 2500 });
    const data = JSON.parse(stdout) as { Self?: { HostName?: string; TailscaleIPs?: string[]; Online?: boolean } };
    return {
      enabled: true,
      status: data.Self?.Online ? "online" : "offline",
      hostname: data.Self?.HostName ?? config.TAILSCALE_HOSTNAME,
      tailnet_ip: data.Self?.TailscaleIPs?.[0]
    };
  } catch {
    return { enabled: true, status: "offline", hostname: config.TAILSCALE_HOSTNAME };
  }
}

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => healthPayload(app));
  app.get("/api/v1/health", async () => healthPayload(app));
}

export async function healthPayload(app: FastifyInstance) {
  let db: "ok" | "error" = "ok";
  try {
    await app.prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "error";
  }
  const agents = Object.fromEntries(await Promise.all(listAgents().map(async (agent) => [agent.id, (await agent.health()).status])));
  const tailscale = await tailscaleStatus();
  const ok = db === "ok" && (!config.TAILSCALE_ENABLED || tailscale.status === "online") && agents.hermes !== "offline";
  return {
    ok,
    service: config.serviceName,
    version: config.version,
    time: new Date().toISOString(),
    db,
    tailscale,
    agents
  };
}
