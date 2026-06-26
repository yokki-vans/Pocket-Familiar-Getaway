import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticateDeviceCredentials } from "../auth/device-auth.js";
import { config } from "../config.js";
import { normalizeResultCard } from "../agents/result-card.js";

const startSchema = z.object({
  type: z.literal("session_start"),
  session_id: z.string().min(1).max(80),
  format: z.object({
    codec: z.literal("pcm_s16le"),
    sample_rate: z.literal(16000),
    channels: z.literal(1)
  })
});

export async function audioWsRoutes(app: FastifyInstance, prefix: string) {
  app.get(`${prefix}/audio/command`, { websocket: true }, async (socket, request) => {
    const query = request.query as { device_id?: string; token?: string };
    const header = request.headers.authorization ?? "";
    const token = query.token ?? (header.startsWith("Bearer ") ? header.slice(7) : undefined);
    const device = await authenticateDeviceCredentials(app, query.device_id, token);
    if (!device) {
      socket.close(1008, "unauthorized");
      return;
    }
    await mkdir(config.UPLOAD_DIR, { recursive: true });
    let started = false;
    let output: ReturnType<typeof createWriteStream> | null = null;
    socket.on("message", (message: Buffer, isBinary: boolean) => {
      try {
        if (isBinary) {
          if (started && output) output.write(message);
          return;
        }
        const parsed = JSON.parse(message.toString()) as { type?: string };
        if (parsed.type === "session_start") {
          const start = startSchema.safeParse(parsed);
          if (!start.success) {
            socket.send(JSON.stringify({ type: "error", error: { code: "VALIDATION_ERROR", message: "Invalid request" } }));
            return;
          }
          started = true;
          output = createWriteStream(path.join(config.UPLOAD_DIR, `${start.data.session_id}-${nanoid(8)}.pcm`));
          socket.send(JSON.stringify({ type: "session_ack", session_id: start.data.session_id }));
          return;
        }
        if (parsed.type === "session_end") {
          output?.end();
          const result = normalizeResultCard({
            kind: "answer",
            title: "Received",
            body: "Audio command received.",
            agent: device.activeAgent,
            actions: [{ id: "done", label: "Done" }]
          });
          socket.send(JSON.stringify({ type: "result", result }));
          return;
        }
        socket.send(JSON.stringify({ type: "error", error: { code: "VALIDATION_ERROR", message: "Invalid request" } }));
      } catch {
        socket.send(JSON.stringify({ type: "error", error: { code: "VALIDATION_ERROR", message: "Invalid request" } }));
      }
    });
    socket.on("close", () => output?.end());
  });
}
