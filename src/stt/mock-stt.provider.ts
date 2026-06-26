import type { SttProvider } from "./stt-provider.js";

export class MockSttProvider implements SttProvider {
  async transcribe() {
    return "This is a mock transcription for the uploaded Pocket Familiar voice note.";
  }
}
