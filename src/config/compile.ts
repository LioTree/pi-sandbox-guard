import { compilePathPolicy } from "../policy/path-policy";
import type { EffectiveConfig, RawGuardConfig } from "./effective";

export function compileEffectiveConfig(raw: RawGuardConfig, sourcePath: string, cwd: string): EffectiveConfig {
  return {
    sourcePath,
    cwd,
    enabled: raw.enabled,
    sandboxRuntime: raw.sandbox,
    enforcement: raw.enforcement,
    reviewer: raw.reviewer,
    pathPolicy: compilePathPolicy(raw.sandbox.filesystem, cwd),
  };
}
