import { describe, expect, it } from "vitest";
import { normalizeResultCard } from "../src/agents/result-card.js";

describe("result cards", () => {
  it("limits screen payloads", () => {
    const card = normalizeResultCard({
      agent: "hermes",
      title: "x".repeat(80),
      body: "y".repeat(400),
      actions: [
        { id: "retry", label: "Retry with a very long label" },
        { id: "done", label: "Done" },
        { id: "extra", label: "Extra" }
      ]
    });
    expect(card.title.length).toBeLessThanOrEqual(32);
    expect(card.body.length).toBeLessThanOrEqual(280);
    expect(card.actions).toHaveLength(2);
    expect(card.actions[0].label.length).toBeLessThanOrEqual(16);
  });
});
