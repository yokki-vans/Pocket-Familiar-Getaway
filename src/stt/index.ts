import { config } from "../config.js";
import { ElevenLabsSttProvider } from "./elevenlabs-stt.provider.js";
import { HermesSttProvider } from "./hermes-stt.provider.js";
import { MockSttProvider } from "./mock-stt.provider.js";
import { OpenAiSttProvider } from "./openai-stt.provider.js";

export function getSttProvider() {
  if (config.STT_PROVIDER === "elevenlabs") return new ElevenLabsSttProvider();
  if (config.STT_PROVIDER === "hermes") return new HermesSttProvider();
  if (config.STT_PROVIDER === "openai") return new OpenAiSttProvider();
  return new MockSttProvider();
}
