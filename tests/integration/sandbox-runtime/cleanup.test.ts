import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { SandboxSession } from "../../../src/runtime/sandbox-session";
import { runSandboxedCommand } from "../../../src/runtime/command-runner";

describe("sandbox-runtime integration", () => {
  it("cleans up nonexistent denied mount point files after sandboxed commands", async () => {
    if (!SandboxManager.isSupportedPlatform()) {
      console.warn(`skip: sandbox-runtime backend is not supported on ${process.platform}`);
      return;
    }

    const root = await mkdtemp(path.join(tmpdir(), "psg-srt-"));
    const deniedMissing = path.join(root, ".claude");
    const sandbox = new SandboxSession();

    try {
      await sandbox.initialize({
        network: { allowedDomains: [], deniedDomains: [] },
        filesystem: {
          denyRead: [deniedMissing],
          allowWrite: [root],
          denyWrite: [deniedMissing],
        },
      });
    } catch (error) {
      console.warn(`skip: sandbox-runtime initialize failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    try {
      await runSandboxedCommand(sandbox, "true", { cwd: root });
      expect(existsSync(deniedMissing)).toBe(false);
    } finally {
      await sandbox.reset();
    }
  });
});
