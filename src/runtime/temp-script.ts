import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function withTempScript<T>(command: string, fn: (scriptPath: string) => Promise<T>): Promise<T> {
  const dir = path.join(tmpdir(), "pi-sandbox-guard");
  await mkdir(dir, { recursive: true });
  const scriptPath = path.join(dir, `cmd-${randomUUID()}.sh`);
  await writeFile(scriptPath, command, { mode: 0o700 });
  try {
    return await fn(scriptPath);
  } finally {
    await rm(scriptPath, { force: true });
  }
}
