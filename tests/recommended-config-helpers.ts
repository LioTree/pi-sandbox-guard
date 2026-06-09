import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RawGuardConfig } from "../src/config/effective";
import { parseGuardConfig } from "../src/config/schema";

export type RecommendedPlatform = "linux" | "macos";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function recommendedConfigPath(platform: RecommendedPlatform): string {
  return path.join(repoRoot, "docs", `recommended-config.${platform}.json`);
}

export async function loadRecommendedConfig(platform: RecommendedPlatform): Promise<RawGuardConfig> {
  const sourcePath = recommendedConfigPath(platform);
  const raw = JSON.parse(await readFile(sourcePath, "utf-8")) as unknown;
  return parseGuardConfig(raw, sourcePath);
}

export function materializeRecommendedConfig(raw: RawGuardConfig, cwd: string): RawGuardConfig {
  const filesystem = raw.sandbox.filesystem;
  return {
    ...raw,
    sandbox: {
      ...raw.sandbox,
      filesystem: {
        ...filesystem,
        denyRead: filesystem.denyRead.map((value) => materializePathRule(value, cwd)),
        allowRead: filesystem.allowRead?.map((value) => materializePathRule(value, cwd)),
        allowWrite: filesystem.allowWrite.map((value) => materializePathRule(value, cwd)),
        denyWrite: filesystem.denyWrite.map((value) => materializePathRule(value, cwd)),
      },
    },
  };
}

export function sh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function materializePathRule(value: string, cwd: string): string {
  if (value === "~" || value.startsWith("~/") || path.isAbsolute(value)) {
    return value;
  }
  return path.join(cwd, value);
}
