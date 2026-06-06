import { access, readFile } from "node:fs/promises";
import { ConfigError } from "../errors";
import type { AuditSink } from "../audit";
import { compileEffectiveConfig } from "./compile";
import type { ConfigLoadResult } from "./effective";
import { getConfigSearchPaths } from "./locations";
import { parseGuardConfig } from "./schema";

export async function loadEffectiveConfig(cwd: string, audit?: AuditSink): Promise<ConfigLoadResult> {
  const searchPaths = getConfigSearchPaths(cwd);

  for (const configPath of searchPaths) {
    if (!(await pathExists(configPath))) {
      continue;
    }

    try {
      const rawText = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(rawText) as unknown;
      const rawConfig = parseGuardConfig(parsed, configPath);
      const config = compileEffectiveConfig(rawConfig, configPath, cwd);
      audit?.({ type: "config_loaded", sourcePath: configPath, enabled: config.enabled });
      if (!config.enabled) {
        return { kind: "disabled", reason: `config disabled at ${configPath}` };
      }
      return { kind: "loaded", config };
    } catch (error) {
      const configError =
        error instanceof ConfigError ? error : new ConfigError(`failed to load config at ${configPath}`, error);
      audit?.({ type: "config_error", sourcePath: configPath, message: configError.message });
      return { kind: "error", error: configError };
    }
  }

  audit?.({ type: "config_missing", cwd, checkedPaths: searchPaths });
  return { kind: "disabled", reason: `no config found; checked ${searchPaths.join(", ")}` };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
