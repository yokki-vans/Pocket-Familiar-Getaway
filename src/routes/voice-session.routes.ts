import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { authenticateDeviceCredentials } from "../auth/device-auth.js";
import { getAgent } from "../agents/agent-registry.js";
import { normalizeResultCard } from "../agents/result-card.js";
import { config } from "../config.js";
import { getSttProvider } from "../stt/index.js";
import { synthesizeSpeech } from "../tts/index.js";
import { resolveVoiceId } from "../tts/voices.js";
import { createTaskFromResult } from "../tasks/task.service.js";
import { pcmToWav, wavPayload } from "../voice/wav.js";

const startSchema = z.object({
  type: z.literal("session.start"),
  session_id: z.string().min(1).max(96),
  mode: z.string().default("voice_assistant"),
  active_agent: z.string().default("hermes"),
  assistant_voice_id: z.string().min(8).max(64).optional(),
  audio: z.object({
    format: z.literal("pcm_s16le"),
    sample_rate: z.literal(16000),
    channels: z.literal(1),
    chunk_ms: z.number().int().positive().max(100).default(40)
  })
});

function safeSend(socket: { readyState: number; OPEN: number; send(data: string | Buffer): void }, data: unknown) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(data));
}

function shortSpeak(result: { kind?: string; body?: string; title?: string }) {
  if (result.kind === "task_created") return "Принял. Задача создана.";
  if (result.kind === "error") return "Hermes сейчас недоступен.";
  const body = (result.body ?? "").trim();
  if (body.length > 0 && body.length <= 180) return body;
  if (body.length > 180) return `${body.slice(0, 150)}…`;
  return result.title || "Готово.";
}

function errorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  if (!raw || raw === "[object Object]") return "Voice session failed";
  return raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
}

export async function voiceSessionRoutes(app: FastifyInstance, prefix: string) {
  app.get(`${prefix}/voice/session`, { websocket: true }, async (socket, request) => {
    const query = request.query as { device_id?: string; token?: string };
    const header = request.headers.authorization ?? "";
    const token = query.token ?? (header.startsWith("Bearer ") ? header.slice(7) : undefined);
    const device = await authenticateDeviceCredentials(app, query.device_id, token);
    if (!device) {
      request.log.warn({ device_id: query.device_id }, "voice session unauthorized");
      socket.close(1008, "unauthorized");
      return;
    }
    const authDevice = device;

    let started = false;
    let ended = false;
    let start: z.infer<typeof startSchema> | undefined;
    const chunks: Buffer[] = [];
    let bytes = 0;
    const maxBytes = config.VOICE_SESSION_MAX_SECONDS * 16000 * 2;
    const startedAt = Date.now();

    async function finish(reason = "client_end") {
      if (ended || !started || !start) return;
      ended = true;
      safeSend(socket, { type: "assistant.state", state: "thinking" });
      safeSend(socket, { type: "agent.status", agent: "hermes", status: "thinking", message: "Hermes is processing your request" });

      try {
        if (!bytes) throw new Error("No audio received");
        await mkdir(config.UPLOAD_DIR, { recursive: true });
        const wavPath = path.join(config.UPLOAD_DIR, `${start.session_id}-${nanoid(8)}.wav`);
        await writeFile(wavPath, pcmToWav(Buffer.concat(chunks, bytes), 16000, 1, 16));

        const transcript = (await getSttProvider().transcribe({ filePath: wavPath, mimeType: "audio/wav" })).trim();
        if (!transcript) {
          safeSend(socket, { type: "error", code: "EMPTY_TRANSCRIPT", message: "Could not hear" });
          return;
        }
        safeSend(socket, { type: "stt.final", text: transcript });

        const agent = getAgent("hermes");
        const result = await agent.sendTextCommand({
          text: transcript,
          deviceId: authDevice.id,
          sessionId: start.session_id,
          context: { source: "realtime_voice_session", reason }
        });
        const card = normalizeResultCard(result);
        safeSend(socket, { type: "result.card", result: card });

        if (card.kind === "task_created" || card.status === "queued" || card.status === "running") {
          const task = createTaskFromResult({ deviceId: authDevice.id, sessionId: start.session_id, result: card });
          safeSend(socket, {
            type: "task.created",
            task_id: task.id,
            title: task.title,
            status: task.status,
            message: task.message
          });
        }

        const voiceId = resolveVoiceId(start.assistant_voice_id);
        const speech = await synthesizeSpeech(shortSpeak(card), { voiceId }).catch((err) => {
          request.log.warn({ err }, "voice session TTS failed");
          return null;
        });
        if (speech) {
          const wav = await readFile(speech.filePath);
          const pcm = wavPayload(wav);
          safeSend(socket, { type: "tts.start", audio: { format: "pcm_s16le", sample_rate: 16000, channels: 1 } });
          for (let off = 0; off < pcm.length && socket.readyState === socket.OPEN; off += 1280) {
            socket.send(pcm.subarray(off, off + 1280));
          }
          safeSend(socket, { type: "tts.end" });
        }
        safeSend(socket, { type: "assistant.state", state: card.kind === "error" ? "error" : "done" });
      } catch (err) {
        request.log.warn({ err }, "voice session failed");
        safeSend(socket, { type: "error", code: "VOICE_SESSION_FAILED", message: errorMessage(err) });
        safeSend(socket, { type: "assistant.state", state: "error" });
      }
    }

    socket.on("message", (message: Buffer, isBinary: boolean) => {
      void (async () => {
        if (ended) return;
        if (isBinary) {
          if (!started) return;
          bytes += message.length;
          if (bytes > maxBytes || Date.now() - startedAt > config.VOICE_SESSION_MAX_SECONDS * 1000) {
            await finish("max_duration");
            return;
          }
          chunks.push(Buffer.from(message));
          if (bytes > 1280 && bytes % (1280 * 12) < 1280) {
            safeSend(socket, { type: "stt.partial", text: "…" });
          }
          return;
        }
        const parsed = JSON.parse(message.toString()) as { type?: string };
        if (parsed.type === "session.start") {
          const valid = startSchema.safeParse(parsed);
          if (!valid.success) {
            safeSend(socket, { type: "error", code: "VALIDATION_ERROR", message: "Invalid session.start" });
            return;
          }
          start = valid.data;
          started = true;
          safeSend(socket, { type: "session.ready", session_id: start.session_id, server_time: new Date().toISOString() });
          return;
        }
        if (parsed.type === "session.end") {
          await finish("session_end");
          return;
        }
        if (parsed.type === "session.cancel") {
          ended = true;
          safeSend(socket, { type: "assistant.state", state: "ready" });
          return;
        }
        safeSend(socket, { type: "error", code: "VALIDATION_ERROR", message: "Invalid event" });
      })().catch(() => safeSend(socket, { type: "error", code: "VALIDATION_ERROR", message: "Invalid event" }));
    });
    socket.on("close", () => {
      ended = true;
    });
  });
}
