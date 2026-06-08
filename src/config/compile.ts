import { compilePathPolicy } from "../policy/path-policy";
import type { EffectiveConfig, RawGuardConfig } from "./effective";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import os from "node:os";

const GREP_MAX_LINE_CHARS = 500;

export function compileEffectiveConfig(raw: RawGuardConfig, sourcePath: string, cwd: string): EffectiveConfig {
  return {
    sourcePath,
    cwd,
    enabled: raw.enabled,
    sandboxRuntime: raw.sandbox,
    enforcement: raw.enforcement,
    reviewer: raw.reviewer,
    toolOutput: {
      maxLines: DEFAULT_MAX_LINES,
      maxBytes: DEFAULT_MAX_BYTES,
      grepMaxLineChars: GREP_MAX_LINE_CHARS,
      fullOutputDir: os.tmpdir(),
    },
    pathPolicy: compilePathPolicy(raw.sandbox.filesystem, cwd),
  };
}
