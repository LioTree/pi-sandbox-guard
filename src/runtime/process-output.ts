export type ProcessOutput = {
  stdout: string;
  stderr: string;
};

export function appendChunk(current: string, chunk: Buffer | string): string {
  return current + chunk.toString();
}
