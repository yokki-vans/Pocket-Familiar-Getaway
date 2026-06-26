export interface SttProvider {
  transcribe(input: { filePath: string; mimeType: string }): Promise<string>;
}
