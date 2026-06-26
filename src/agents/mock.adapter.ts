import type { AgentAdapter } from "./agent-adapter.js";
import { normalizeResultCard } from "./result-card.js";

export class MockAgentAdapter implements AgentAdapter {
  constructor(public id: string, public name: string, private configured = false) {}

  async health() {
    return { status: this.configured ? "online" as const : "not_configured" as const, configured: this.configured };
  }

  async sendTextCommand(input: { text: string }) {
    return normalizeResultCard({
      kind: "task_created",
      title: "Task created",
      body: `Mock queued: ${input.text}`,
      status: "queued",
      agent: this.id,
      actions: [{ id: "done", label: "Done" }]
    });
  }

  async sendVoiceNote() {
    return normalizeResultCard({
      kind: "task_created",
      title: "Voice note queued",
      body: "Mock agent received the voice note.",
      status: "queued",
      agent: this.id,
      actions: [{ id: "done", label: "Done" }]
    });
  }
}
