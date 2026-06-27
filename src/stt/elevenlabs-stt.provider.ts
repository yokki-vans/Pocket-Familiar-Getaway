import fetch, { FormData, fileFromSync } from "node-fetch";
import { config } from "../config.js";
import type { SttProvider } from "./stt-provider.js";

export class ElevenLabsSttProvider implements SttProvider {
  async transcribe(input: { filePath: string; mimeType: string }) {
    if (!config.ELEVENLABS_API_KEY) throw new Error("ElevenLabs STT is not configured");

    const form = new FormData();
    form.set("model_id", config.ELEVENLABS_STT_MODEL_ID);
    form.set("file", fileFromSync(input.filePath, input.mimeType));

    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": config.ELEVENLABS_API_KEY },
      body: form,
      signal: AbortSignal.timeout(90000)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ElevenLabs transcription failed: ${res.status} ${body.slice(0, 240)}`);
    }
    const data = await res.json() as { text?: string };
    return data.text?.trim() ?? "";
  }
}
