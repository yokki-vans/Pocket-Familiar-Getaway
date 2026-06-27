import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import fetch from "node-fetch";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { resolveVoiceId } from "./voices.js";

function pcmSampleRate(outputFormat: string) {
  const match = /^pcm_(\d+)$/.exec(outputFormat);
  return match ? Number(match[1]) : 16000;
}

function wavHeader(dataBytes: number, sampleRate: number, channels = 1, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

function toWav(audio: Buffer) {
  if (audio.subarray(0, 4).toString("ascii") === "RIFF") return audio;
  return Buffer.concat([wavHeader(audio.length, pcmSampleRate(config.ELEVENLABS_OUTPUT_FORMAT)), audio]);
}

export async function synthesizeWithElevenLabs(text: string, options: { voiceId?: string | null } = {}) {
  if (!config.ELEVENLABS_API_KEY || !text.trim()) return null;
  await mkdir(config.UPLOAD_DIR, { recursive: true });
  const fileName = `assistant-${new Date().toISOString().slice(0, 10)}-${nanoid(16)}.wav`;
  const filePath = path.join(config.UPLOAD_DIR, fileName);
  const url = new URL(`/v1/text-to-speech/${encodeURIComponent(resolveVoiceId(options.voiceId))}`, "https://api.elevenlabs.io");
  url.searchParams.set("output_format", config.ELEVENLABS_OUTPUT_FORMAT);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": config.ELEVENLABS_API_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      text: text.slice(0, 5000),
      model_id: config.ELEVENLABS_MODEL_ID
    }),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new Error(`ElevenLabs speech synthesis failed: ${res.status}`);
  const audio = Buffer.from(await res.arrayBuffer());
  if (!audio.length) throw new Error("ElevenLabs speech synthesis returned an empty body");
  await writeFile(filePath, toWav(audio), { flag: "wx" });
  return { fileName, filePath, mimeType: "audio/wav" };
}
