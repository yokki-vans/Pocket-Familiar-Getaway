import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import fetch from "node-fetch";
import { nanoid } from "nanoid";
import { config } from "../config.js";

export async function synthesizeSpeech(text: string) {
  if (!config.OPENAI_API_KEY || !text.trim()) return null;
  await mkdir(config.UPLOAD_DIR, { recursive: true });
  const fileName = `assistant-${new Date().toISOString().slice(0, 10)}-${nanoid(16)}.wav`;
  const filePath = path.join(config.UPLOAD_DIR, fileName);
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: config.OPENAI_TTS_MODEL,
      voice: config.OPENAI_TTS_VOICE,
      input: text.slice(0, 4000),
      response_format: "wav"
    }),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok || !res.body) throw new Error("Speech synthesis failed");
  await pipeline(res.body, createWriteStream(filePath, { flags: "wx" }));
  return { fileName, filePath, mimeType: "audio/wav" };
}
