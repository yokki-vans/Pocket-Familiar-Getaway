import { nanoid } from "nanoid";
import type { FastifyInstance } from "fastify";
import { getAgent } from "../agents/agent-registry.js";
import { getSttProvider } from "../stt/index.js";

export function newNoteId() {
  return `note_${nanoid(24)}`;
}

export async function transcribeNote(app: FastifyInstance, deviceId: string, noteId: string) {
  const note = await app.prisma.voiceNote.findFirst({ where: { id: noteId, deviceId } });
  if (!note) return null;
  await app.prisma.voiceNote.update({ where: { id: note.id }, data: { transcriptionStatus: "transcribing" } });
  try {
    const transcript = await getSttProvider().transcribe({ filePath: note.filePath, mimeType: note.mimeType });
    return app.prisma.voiceNote.update({
      where: { id: note.id },
      data: { transcript, transcriptionStatus: "transcribed" }
    });
  } catch (err) {
    await app.prisma.voiceNote.update({ where: { id: note.id }, data: { transcriptionStatus: "failed" } });
    throw err instanceof Error ? err : new Error("TRANSCRIPTION_FAILED");
  }
}

export async function sendNoteToAgent(app: FastifyInstance, deviceId: string, noteId: string, agentId?: string) {
  let note = await app.prisma.voiceNote.findFirst({ where: { id: noteId, deviceId } });
  if (!note) return null;
  if (!note.transcript) note = await transcribeNote(app, deviceId, noteId);
  if (!note) return null;
  const agent = getAgent(agentId ?? note.activeAgent);
  const result = agent.sendVoiceNote
    ? await agent.sendVoiceNote({ noteId, transcript: note?.transcript ?? undefined, filePath: note?.filePath, deviceId, sessionId: `sess_${nanoid(12)}` })
    : await agent.sendTextCommand({ text: note?.transcript ?? `Voice note ${noteId}`, deviceId, sessionId: `sess_${nanoid(12)}` });
  await app.prisma.voiceNote.update({
    where: { id: noteId },
    data: { agentSendStatus: result.kind === "error" ? "failed" : "sent", activeAgent: agent.id }
  });
  await app.prisma.agentEvent.create({
    data: {
      deviceId,
      agentId: agent.id,
      type: "voice_note",
      requestJson: { noteId },
      resultCardJson: result as never,
      status: result.kind === "error" ? "failed" : "sent"
    }
  });
  return result;
}
