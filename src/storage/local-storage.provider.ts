import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import type { StorageProvider } from "./storage-provider.js";

export class LocalStorageProvider implements StorageProvider {
  async saveVoiceNote(input: AsyncIterable<Buffer>, originalFilename?: string) {
    await mkdir(config.UPLOAD_DIR, { recursive: true });
    const filePath = path.join(config.UPLOAD_DIR, `${new Date().toISOString().slice(0, 10)}-${nanoid(16)}.wav`);
    let sizeBytes = 0;
    async function* countingStream() {
      for await (const chunk of input) {
        sizeBytes += chunk.length;
        yield chunk;
      }
    }
    await pipeline(countingStream(), createWriteStream(filePath, { flags: "wx" }));
    return { filePath, sizeBytes, originalFilename };
  }
}
