import { config } from "../config.js";
import { synthesizeWithElevenLabs } from "./elevenlabs-tts.provider.js";
import { synthesizeWithOpenAi } from "./openai-tts.provider.js";

export async function synthesizeSpeech(text: string) {
  if (config.TTS_PROVIDER === "none") return null;
  if (config.TTS_PROVIDER === "elevenlabs") return synthesizeWithElevenLabs(text);
  return synthesizeWithOpenAi(text);
}
