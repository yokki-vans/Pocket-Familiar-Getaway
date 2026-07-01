import { access } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireDevice } from "../auth/device-auth.js";
import { LocalStorageProvider } from "../storage/local-storage.provider.js";
import { assertSafeWav, voiceNoteMetadataSchema } from "../voice-notes/wav-validation.js";
import { newNoteId, sendNoteToAgent, transcribeNote } from "../voice-notes/voice-note.service.js";

const idParams = z.object({ id: z.string().min(1) });
const sendSchema = z.object({ agent_id: z.string().optional(), mode: z.enum(["transcript_or_audio"]).default("transcript_or_audio") });

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function drainPart(input: AsyncIterable<Buffer>) {
  for await (const _chunk of input) {
    // Drain duplicate/invalid uploads so the client can finish cleanly.
  }
}

function parseMetadataPart(value: unknown) {
  let parsedJson: unknown = value;
  if (typeof value === "string") {
    try {
      parsedJson = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = voiceNoteMetadataSchema.safeParse(parsedJson);
  return parsed.success ? parsed.data : null;
}

export async function voiceNotesRoutes(app: FastifyInstance, prefix: string) {
  const storage = new LocalStorageProvider();

  app.post(`${prefix}/voice-notes/upload`, { preHandler: requireDevice, config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!request.device) return reply.code(401).send({ error: { code: "DEVICE_UNAUTHORIZED", message: "Device unauthorized" } });
    const parts = request.parts();
    let metadata: z.infer<typeof voiceNoteMetadataSchema> | null = null;
    let storedFile: Awaited<ReturnType<LocalStorageProvider["saveVoiceNote"]>> | null = null;
    let storedMimeType = "audio/wav";
    for await (const part of parts) {
      if (part.type === "field" && part.fieldname === "metadata") {
        metadata = parseMetadataPart(part.value);
        if (!metadata) {
          return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
        }
      }
      if (part.type === "file" && part.fieldname === "file") {
        if (!metadata) {
          await drainPart(part.file);
          return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Metadata must precede file" } });
        }
        try {
          assertSafeWav(part.filename, part.mimetype);
        } catch {
          await drainPart(part.file);
          return reply.code(415).send({ error: { code: "INVALID_FILE", message: "Invalid file" } });
        }
        const existing = await app.prisma.voiceNote.findFirst({
          where: { deviceId: request.device.id, localNoteId: metadata.local_note_id }
        });
        if (existing) {
          if (await fileExists(existing.filePath)) {
            await drainPart(part.file);
            return { ok: true, note_id: existing.id, status: existing.status, existing: true };
          }
          storedMimeType = part.mimetype;
          storedFile = await storage.saveVoiceNote(part.file, part.filename);
          const repaired = await app.prisma.voiceNote.update({
            where: { id: existing.id },
            data: {
              title: metadata.title,
              filePath: storedFile.filePath,
              originalFilename: storedFile.originalFilename,
              mimeType: storedMimeType,
              sizeBytes: storedFile.sizeBytes,
              durationMs: metadata.duration_ms,
              sampleRate: metadata.sample_rate,
              bitsPerSample: metadata.bits_per_sample,
              channels: metadata.channels,
              status: "uploaded",
              transcriptionStatus: "not_transcribed",
              transcript: null,
              createdAtDevice: new Date(metadata.created_at)
            }
          });
          return { ok: true, note_id: repaired.id, status: "uploaded", existing: true, repaired: true };
        }
        storedMimeType = part.mimetype;
        storedFile = await storage.saveVoiceNote(part.file, part.filename);
      }
    }
    if (!storedFile || !metadata) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    }
    if (storedFile.sizeBytes !== metadata.size_bytes) {
      request.log.warn({ declared: metadata.size_bytes, actual: storedFile.sizeBytes }, "voice note size differs from metadata");
    }
    const note = await app.prisma.voiceNote.create({
      data: {
        id: newNoteId(),
        deviceId: request.device.id,
        localNoteId: metadata.local_note_id,
        title: metadata.title,
        filePath: storedFile.filePath,
        originalFilename: storedFile.originalFilename,
        mimeType: storedMimeType,
        sizeBytes: storedFile.sizeBytes,
        durationMs: metadata.duration_ms,
        sampleRate: metadata.sample_rate,
        bitsPerSample: metadata.bits_per_sample,
        channels: metadata.channels,
        activeAgent: request.device.activeAgent,
        createdAtDevice: new Date(metadata.created_at)
      }
    }).catch(async (err) => {
      const duplicate = await app.prisma.voiceNote.findFirst({
        where: { deviceId: request.device!.id, localNoteId: metadata!.local_note_id }
      });
      if (duplicate) return duplicate;
      throw err;
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
    } catch (err) {
      request.log.warn({ err, note_id: params.success ? params.data.id : undefined }, "voice note transcription failed");
      const message = err instanceof Error && err.message ? err.message : "Transcription failed";
      return reply.code(500).send({ ok: false, error: { code: "TRANSCRIPTION_FAILED", message } });
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
    const availableNotes = [];
    for (const note of notes) {
      if (await fileExists(note.filePath)) availableNotes.push(note);
    }
    return {
      notes: availableNotes.map((note) => ({
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
