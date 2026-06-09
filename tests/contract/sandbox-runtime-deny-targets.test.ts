import path from "node:path";
import { describe, expect, it } from "vitest";
import { DANGEROUS_FILES, getDangerousDirectories } from "@anthropic-ai/sandbox-runtime/dist/sandbox/sandbox-utils.js";
import { loadRecommendedConfig } from "../recommended-config-helpers";

const gitDirectoryTargets = [".git/hooks", ".git/config"];

function recommendedWriteDenyTargetsMirroringSandboxRuntime(): string[] {
  return [...DANGEROUS_FILES, ...getDangerousDirectories(), ...gitDirectoryTargets];
}

describe("recommended config sandbox-runtime deny target coverage", () => {
  it("covers sandbox-runtime write deny targets in the Linux config", async () => {
    const config = await loadRecommendedConfig("linux");
    const denyWrite = new Set(config.sandbox.filesystem.denyWrite);

    for (const target of recommendedWriteDenyTargetsMirroringSandboxRuntime()) {
      expect(denyWrite, `missing Linux denyWrite target: ${target}`).toContain(target);
    }
  });

  it("covers sandbox-runtime write deny targets in the macOS config", async () => {
    const config = await loadRecommendedConfig("macos");
    const denyWrite = config.sandbox.filesystem.denyWrite;

    for (const target of recommendedWriteDenyTargetsMirroringSandboxRuntime()) {
      expect(coversRelativeWriteTarget(denyWrite, target), `missing macOS denyWrite coverage for: ${target}`).toBe(true);
    }
  });
});

function coversRelativeWriteTarget(patterns: string[], target: string): boolean {
  const normalizedTarget = target.split(path.sep).join("/");
  if (patterns.includes(normalizedTarget) || patterns.includes(`**/${normalizedTarget}`)) {
    return true;
  }

  let ancestor = path.posix.dirname(normalizedTarget);
  while (ancestor !== "." && ancestor !== "/") {
    if (patterns.includes(`${ancestor}/**`) || patterns.includes(`**/${ancestor}/**`)) {
      return true;
    }
    ancestor = path.posix.dirname(ancestor);
  }

  return false;
}
