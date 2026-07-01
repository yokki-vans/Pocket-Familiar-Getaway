import { config } from "../config.js";
import { ElevenLabsSttProvider } from "./elevenlabs-stt.provider.js";
import { HermesSttProvider } from "./hermes-stt.provider.js";
import { MockSttProvider } from "./mock-stt.provider.js";
import { OpenAiSttProvider } from "./openai-stt.provider.js";
import type { SttProvider } from "./stt-provider.js";

class FallbackSttProvider implements SttProvider {
  constructor(
    private readonly primary: SttProvider,
    private readonly fallback: SttProvider,
    private readonly primaryName: string,
    private readonly fallbackName: string
  ) {}

  async transcribe(input: { filePath: string; mimeType: string }) {
    try {
      return await this.primary.transcribe(input);
    } catch (primaryError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
      try {
        return await this.fallback.transcribe(input);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`${this.primaryName} STT failed: ${primaryMessage}; ${this.fallbackName} STT failed: ${fallbackMessage}`);
      }
    }
  }
}

export function getSttProvider() {
  if (config.STT_PROVIDER === "elevenlabs") return new ElevenLabsSttProvider();
  if (config.STT_PROVIDER === "hermes") {
    const hermes = new HermesSttProvider();
    return config.ELEVENLABS_API_KEY ? new FallbackSttProvider(hermes, new ElevenLabsSttProvider(), "Hermes", "ElevenLabs") : hermes;
  }
  if (config.STT_PROVIDER === "openai") {
    const openai = new OpenAiSttProvider();
    return config.ELEVENLABS_API_KEY ? new FallbackSttProvider(openai, new ElevenLabsSttProvider(), "OpenAI", "ElevenLabs") : openai;
  }
  return new MockSttProvider();
}
