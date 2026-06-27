export function pcmToWav(pcm: Buffer, sampleRate = 16000, channels = 1, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function wavPayload(audio: Buffer) {
  if (audio.subarray(0, 4).toString("ascii") !== "RIFF") return audio;
  let off = 12;
  while (off + 8 <= audio.length) {
    const id = audio.subarray(off, off + 4).toString("ascii");
    const size = audio.readUInt32LE(off + 4);
    if (id === "data") return audio.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  return audio.length > 44 ? audio.subarray(44) : Buffer.alloc(0);
}
