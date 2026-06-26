import type { ResultCard } from "./result-card.js";

export interface AgentHealth {
  status: "online" | "offline" | "not_configured";
  configured: boolean;
}

export interface AgentAdapter {
  id: string;
  name: string;
  health(): Promise<AgentHealth>;
  sendTextCommand(input: {
    text: string;
    deviceId: string;
    sessionId: string;
    context?: Record<string, unknown>;
  }): Promise<ResultCard>;
  sendVoiceNote?(input: {
    noteId: string;
    transcript?: string;
    filePath?: string;
    deviceId: string;
    sessionId: string;
    context?: Record<string, unknown>;
  }): Promise<ResultCard>;
}
