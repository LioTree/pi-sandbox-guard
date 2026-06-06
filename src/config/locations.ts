import { homedir } from "node:os";
import path from "node:path";

export function getProjectConfigPath(cwd: string): string {
  return path.join(cwd, ".pi", "sandbox-guard.json");
}

export function getGlobalConfigPath(): string {
  return path.join(homedir(), ".pi", "agent", "sandbox-guard.json");
}

export function getConfigSearchPaths(cwd: string): string[] {
  return [getProjectConfigPath(cwd), getGlobalConfigPath()];
}
