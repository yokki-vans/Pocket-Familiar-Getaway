import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireDevice } from "../auth/device-auth.js";
import { LocalStorageProvider } from "../storage/local-storage.provider.js";
import { assertSafeWav, voiceNoteMetadataSchema } from "../voice-notes/wav-validation.js";
import { newNoteId, sendNoteToAgent, transcribeNote } from "../voice-notes/voice-note.service.js";

const idParams = z.object({ id: z.string().min(1) });
const sendSchema = z.object({ agent_id: z.string().optional(), mode: z.enum(["transcript_or_audio"]).default("transcript_or_audio") });

export async function voiceNotesRoutes(app: FastifyInstance, prefix: string) {
  const storage = new LocalStorageProvider();

  app.post(`${prefix}/voice-notes/upload`, { preHandler: requireDevice, config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!request.device) return reply.code(401).send({ error: { code: "DEVICE_UNAUTHORIZED", message: "Device unauthorized" } });
    const parts = request.parts();
    let metadata: z.infer<typeof voiceNoteMetadataSchema> | null = null;
    let filePart: Awaited<ReturnType<typeof parts.next>>["value"] | null = null;
    for await (const part of parts) {
      if (part.type === "file" && part.fieldname === "file") filePart = part;
      if (part.type === "field" && part.fieldname === "metadata") {
        const parsedJson = JSON.parse(String(part.value));
        const parsed = voiceNoteMetadataSchema.safeParse(parsedJson);
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
    if (stored.sizeBytes !== metadata.size_bytes) {
      request.log.warn({ declared: metadata.size_bytes, actual: stored.sizeBytes }, "voice note size differs from metadata");
    }
    const note = await app.prisma.voiceNote.create({
      data: {
        id: newNoteId(),
        deviceId: request.device.id,
        localNoteId: metadata.local_note_id,
        title: metadata.title,
        filePath: stored.filePath,
        originalFilename: stored.originalFilename,
        mimeType: filePart.mimetype,
        sizeBytes: stored.sizeBytes,
        durationMs: metadata.duration_ms,
        sampleRate: metadata.sample_rate,
        bitsPerSample: metadata.bits_per_sample,
        channels: metadata.channels,
        activeAgent: request.device.activeAgent,
        createdAtDevice: new Date(metadata.created_at)
      }
    });
    return { ok: true, note_id: note.id, status: "uploaded" };
  });

  app.post(`${prefix}/voice-notes/:id/transcribe`, { preHandler: requireDevice }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success || !request.device) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    try {
      const note = await transcribeNote(app, request.device.id, params.data.id);
      if (!note) return reply.code(404).send({ error: { code: "NOTE_NOT_FOUND", message: "Note not found" } });
      return { ok: true, note_id: note.id, transcription_status: note.transcriptionStatus, transcript: note.transcript };
    } catch {
      return reply.code(500).send({ ok: false, error: { code: "TRANSCRIPTION_FAILED", message: "Transcription failed" } });
    }
  });

  app.post(`${prefix}/voice-notes/:id/send`, { preHandler: requireDevice }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const parsed = sendSchema.safeParse(request.body ?? {});
    if (!params.success || !parsed.success || !request.device) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    const result = await sendNoteToAgent(app, request.device.id, params.data.id, parsed.data.agent_id);
    if (!result) return reply.code(404).send({ error: { code: "NOTE_NOT_FOUND", message: "Note not found" } });
    return { result };
  });

  app.get(`${prefix}/voice-notes`, { preHandler: requireDevice }, async (request) => {
    const notes = await app.prisma.voiceNote.findMany({ where: { deviceId: request.device?.id }, orderBy: { createdAt: "desc" }, take: 50 });
    return {
      notes: notes.map((note) => ({
        id: note.id,
        local_note_id: note.localNoteId,
        title: note.title,
        created_at: note.createdAtDevice.toISOString(),
        duration_ms: note.durationMs,
        status: note.status,
        transcription_status: note.transcriptionStatus,
        agent_send_status: note.agentSendStatus
      }))
    };
  });

  app.get(`${prefix}/voice-notes/:id`, { preHandler: requireDevice }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success || !request.device) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    const note = await app.prisma.voiceNote.findFirst({ where: { id: params.data.id, deviceId: request.device.id } });
    if (!note) return reply.code(404).send({ error: { code: "NOTE_NOT_FOUND", message: "Note not found" } });
    return {
      id: note.id,
      local_note_id: note.localNoteId,
      title: note.title,
      created_at: note.createdAtDevice.toISOString(),
      duration_ms: note.durationMs,
      sample_rate: note.sampleRate,
      bits_per_sample: note.bitsPerSample,
      channels: note.channels,
      status: note.status,
      transcription_status: note.transcriptionStatus,
      transcript: note.transcript,
      agent_send_status: note.agentSendStatus,
      active_agent: note.activeAgent
    };
  });
}
