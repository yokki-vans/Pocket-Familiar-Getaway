export interface StoredFile {
  filePath: string;
  sizeBytes: number;
  originalFilename?: string;
}

export interface StorageProvider {
  saveVoiceNote(input: AsyncIterable<Buffer>, originalFilename?: string): Promise<StoredFile>;
}
