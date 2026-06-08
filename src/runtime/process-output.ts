export type ProcessOutput = {
  stdout: string;
  stderr: string;
};

export function appendChunk(current: string, chunk: Buffer | string): string {
  return current + chunk.toString();
}

export function appendChunkTail(current: string, chunk: Buffer | string, maxBytes: number): string {
  const combined = current + chunk.toString();
  const buffer = Buffer.from(combined, "utf-8");
  if (buffer.length <= maxBytes) {
    return combined;
  }

  let start = buffer.length - maxBytes;
  while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) {
    start++;
  }
  return buffer.subarray(start).toString("utf-8");
}
