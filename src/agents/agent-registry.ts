import { config } from "../config.js";
import type { AgentAdapter } from "./agent-adapter.js";
import { HermesAdapter } from "./hermes.adapter.js";
import { MockAgentAdapter } from "./mock.adapter.js";

const adapters: AgentAdapter[] = [
  new HermesAdapter(),
  new MockAgentAdapter("openclaw", "OpenClaw"),
  new MockAgentAdapter("codex", "Codex"),
  new MockAgentAdapter("custom", "Custom Agent")
];

export function getAgent(id = config.DEFAULT_AGENT) {
  return adapters.find((adapter) => adapter.id === id) ?? adapters[0];
}

export function listAgents() {
  return adapters;
}
