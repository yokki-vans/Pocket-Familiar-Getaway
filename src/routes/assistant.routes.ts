import { createReadStream } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireDevice } from "../auth/device-auth.js";
import { getAgent } from "../agents/agent-registry.js";
import { LocalStorageProvider } from "../storage/local-storage.provider.js";
import { assertSafeWav, voiceNoteMetadataSchema } from "../voice-notes/wav-validation.js";
import { newNoteId, transcribeNote } from "../voice-notes/voice-note.service.js";
import { synthesizeSpeech } from "../tts/index.js";
import { resolveVoiceId } from "../tts/voices.js";
import { config } from "../config.js";

const audioParams = z.object({ file: z.string().regex(/^assistant-\d{4}-\d{2}-\d{2}-[A-Za-z0-9_-]+\.wav$/) });
const voiceParams = z.object({ voiceId: z.string().min(8).max(64) });
const previewText = "Привет, я Куби. Вітаю, я Кубі. Hello, I am Kubi.";

export async function assistantRoutes(app: FastifyInstance, prefix: string) {
  const storage = new LocalStorageProvider();

  app.post(`${prefix}/assistant/voice`, { preHandler: requireDevice, config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!request.device) return reply.code(401).send({ error: { code: "DEVICE_UNAUTHORIZED", message: "Device unauthorized" } });
    const parts = request.parts();
    let metadata: z.infer<typeof voiceNoteMetadataSchema> | null = null;
    let filePart: Awaited<ReturnType<typeof parts.next>>["value"] | null = null;
    for await (const part of parts) {
      if (part.type === "file" && part.fieldname === "file") filePart = part;
      if (part.type === "field" && part.fieldname === "metadata") {
        const parsed = voiceNoteMetadataSchema.safeParse(JSON.parse(String(part.value)));
        if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
        metadata = parsed.data;
      }
    }
    if (!filePart || filePart.type !== "file" || !metadata) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    }
    try {
      assertSafeWav(filePart.filename, filePart.mimetype);
    } catch {
      return reply.code(415).send({ error: { code: "INVALID_FILE", message: "Invalid file" } });
    }

    const stored = await storage.saveVoiceNote(filePart.file, filePart.filename);
    const note = await app.prisma.voiceNote.create({
      data: {
        id: newNoteId(),
        deviceId: request.device.id,
        localNoteId: metadata.local_note_id,
        title: metadata.title || "Kubi request",
        filePath: stored.filePath,
        originalFilename: stored.originalFilename,
        mimeType: filePart.mimetype,
        sizeBytes: stored.sizeBytes,
        durationMs: metadata.duration_ms,
        sampleRate: metadata.sample_rate,
        bitsPerSample: metadata.bits_per_sample,
        channels: metadata.channels,
        activeAgent: "hermes",
        createdAtDevice: new Date(metadata.created_at)
      }
    });

    let transcript = "";
    try {
      const transcribed = await transcribeNote(app, request.device.id, note.id);
      transcript = transcribed?.transcript?.trim() ?? "";
    } catch {
      return reply.code(500).send({ ok: false, error: { code: "TRANSCRIPTION_FAILED", message: "Transcription failed" } });
    }
    if (!transcript) return reply.code(422).send({ ok: false, error: { code: "EMPTY_TRANSCRIPT", message: "No speech detected" } });

    const agent = getAgent("hermes");
    const result = await agent.sendTextCommand({
      text: transcript,
      deviceId: request.device.id,
      sessionId: `assistant_${nanoid(16)}`,
      context: { source: "kubi_home_voice" }
    });
    await app.prisma.agentEvent.create({
      data: {
        deviceId: request.device.id,
        agentId: agent.id,
        type: "assistant_voice",
        requestJson: { noteId: note.id, transcript },
        resultCardJson: result as never,
        status: result.kind === "error" ? "failed" : "sent"
      }
    });

    let speechUrl: string | null = null;
    if (result.kind !== "error") {
      const speech = await synthesizeSpeech(result.body, { voiceId: metadata.assistant_voice_id }).catch((err) => {
        request.log.warn({ err }, "assistant speech synthesis failed");
        return null;
      });
      if (speech) speechUrl = `${config.PUBLIC_GATEWAY_URL}${prefix}/assistant/audio/${speech.fileName}`;
    }

    return {
      ok: result.kind !== "error",
      note_id: note.id,
      transcript,
      result,
      response_text: result.body,
      speech_url: speechUrl
    };
  });

  app.get(`${prefix}/assistant/voice-preview/:voiceId`, { preHandler: requireDevice, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const params = voiceParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid voice" } });
    const speech = await synthesizeSpeech(previewText, { voiceId: resolveVoiceId(params.data.voiceId) }).catch((err) => {
      request.log.warn({ err }, "voice preview synthesis failed");
      return null;
    });
    if (!speech) return reply.code(503).send({ ok: false, error: { code: "TTS_UNAVAILABLE", message: "Voice preview unavailable" } });
    return reply.type("audio/wav").send(createReadStream(speech.filePath));
  });

  app.get(`${prefix}/assistant/audio/:file`, { preHandler: requireDevice }, async (request, reply) => {
    const params = audioParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not found" } });
    const filePath = path.join(config.UPLOAD_DIR, params.data.file);
    return reply.type("audio/wav").send(createReadStream(filePath));
  });
}
