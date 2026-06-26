export type ResultCardKind = "answer" | "task_created" | "action_required" | "error";

export interface ResultCard {
  kind: ResultCardKind;
  title: string;
  body: string;
  status?: string;
  agent: string;
  priority?: "low" | "normal" | "high";
  actions: Array<{ id: string; label: string }>;
}

const trim = (value: string, max: number) => value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;

export function normalizeResultCard(input: Partial<ResultCard> & { agent: string }): ResultCard {
  return {
    kind: input.kind ?? "answer",
    title: trim(input.title ?? "Done", 32),
    body: trim(input.body ?? "", 280),
    status: input.status ? trim(input.status, 32) : undefined,
    agent: trim(input.agent, 32),
    priority: input.priority ?? "normal",
    actions: (input.actions ?? []).slice(0, 2).map((action) => ({
      id: trim(action.id, 32),
      label: trim(action.label, 16)
    }))
  };
}

export function offlineAgentCard(agent: string): ResultCard {
  return normalizeResultCard({
    kind: "error",
    title: "Agent offline",
    body: "Hermes is unreachable. I saved the request for retry.",
    status: "offline",
    agent,
    priority: "normal",
    actions: [
      { id: "retry", label: "Retry" },
      { id: "done", label: "Done" }
    ]
  });
}
