import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { SandboxSession } from "../../src/runtime/sandbox-session";
import { runSandboxedCommand } from "../../src/runtime/command-runner";

describe("sandbox lifecycle integration", () => {
  it("does not reset the sandbox manager while a command is active", async () => {
    if (!SandboxManager.isSupportedPlatform()) {
      console.warn(`skip: sandbox-runtime unsupported on ${process.platform}`);
      return;
    }

    const root = await mkdtemp(path.join(tmpdir(), "psg-sandbox-lifecycle-"));
    const blockedFile = path.join(root, ".blocked");
    const sandbox = new SandboxSession();
    try {
      await sandbox.initialize({
        network: { allowedDomains: [], deniedDomains: [] },
        filesystem: { denyRead: [], allowWrite: [root], denyWrite: [blockedFile] },
      });
    } catch (error) {
      console.warn(`skip: sandbox-runtime initialize failed: ${error instanceof Error ? error.message : String(error)}`);
      await sandbox.reset();
      return;
    }

    let resetResolved = false;
    const command = runSandboxedCommand(
      sandbox,
      `sleep 0.2; printf leak > ${blockedFile} || exit 42; printf after`,
      { cwd: root },
    );
    await delay(50);
    const reset = sandbox.reset().then(() => {
      resetResolved = true;
    });

    await delay(50);
    expect(resetResolved).toBe(false);

    const result = await command;
    await reset;

    expect(result.exitCode).toBe(42);
    await expect(readFile(blockedFile, "utf-8")).rejects.toThrow();
  });
});
