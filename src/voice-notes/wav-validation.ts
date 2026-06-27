import { z } from "zod";

export const voiceNoteMetadataSchema = z.object({
  local_note_id: z.string().min(1).max(96),
  title: z.string().max(80).optional(),
  created_at: z.string().datetime(),
  duration_ms: z.number().int().positive().max(10 * 60 * 1000),
  sample_rate: z.union([z.literal(16000), z.literal(24000), z.literal(32000), z.literal(48000)]),
  bits_per_sample: z.literal(16),
  channels: z.literal(1),
  size_bytes: z.number().int().positive(),
  assistant_voice_id: z.string().min(8).max(64).optional()
});

export function assertSafeWav(filename: string | undefined, mimetype: string) {
  if (filename && /[\/\\\0]/.test(filename)) throw new Error("Unsafe filename");
  const lower = filename?.toLowerCase() ?? "";
  if (!lower.endsWith(".wav") && !["audio/wav", "audio/x-wav", "audio/wave"].includes(mimetype)) {
    throw new Error("Only WAV uploads are supported");
  }
}
