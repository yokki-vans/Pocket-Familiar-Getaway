import { config } from "../config.js";
import { MockSttProvider } from "./mock-stt.provider.js";
import { OpenAiSttProvider } from "./openai-stt.provider.js";

export function getSttProvider() {
  if (config.STT_PROVIDER === "openai") return new OpenAiSttProvider();
  return new MockSttProvider();
}
