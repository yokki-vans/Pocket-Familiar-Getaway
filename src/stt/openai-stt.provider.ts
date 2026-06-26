import { createReadStream } from "node:fs";
import fetch, { FormData, fileFromSync } from "node-fetch";
import { config } from "../config.js";
import type { SttProvider } from "./stt-provider.js";

export class OpenAiSttProvider implements SttProvider {
  async transcribe(input: { filePath: string; mimeType: string }) {
    if (!config.OPENAI_API_KEY) throw new Error("OpenAI STT is not configured");
    const form = new FormData();
    form.set("model", config.OPENAI_STT_MODEL);
    form.set("file", fileFromSync(input.filePath, input.mimeType));
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${config.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(60000)
    });
    if (!res.ok) throw new Error("Transcription failed");
    const data = await res.json() as { text?: string };
    return data.text ?? "";
  }
}

void createReadStream;
