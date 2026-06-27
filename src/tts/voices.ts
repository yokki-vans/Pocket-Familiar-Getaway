import { config } from "../config.js";

export type GatewayVoice = {
  id: string;
  name: string;
  label: string;
};

export const gatewayVoices: GatewayVoice[] = [
  { id: "9BWtsMINqrJLrRacOk9x", name: "Aria", label: "Bright multilingual" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", label: "Warm multilingual" },
  { id: "SAz9YHcvj6GT2YYXdXww", name: "River", label: "Calm multilingual" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger", label: "Deep multilingual" }
];

export function resolveVoiceId(requested?: string | null) {
  const clean = requested?.trim();
  if (clean && gatewayVoices.some((voice) => voice.id === clean)) return clean;
  if (gatewayVoices.some((voice) => voice.id === config.ELEVENLABS_VOICE_ID)) {
    return config.ELEVENLABS_VOICE_ID;
  }
  return gatewayVoices[2].id;
}
