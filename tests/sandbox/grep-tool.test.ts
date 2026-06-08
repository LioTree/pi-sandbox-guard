import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { describe, expect, it } from "vitest";
import { createGrepTool } from "../../src/tools/adapters/grep";
import { SandboxSession } from "../../src/runtime/sandbox-session";
import { effectiveConfig, fakeExtensionContext, makeServices, toolText } from "../helpers";

describe("grep tool sandbox integration", () => {
  it("does not leak matches from denyRead paths when searching an allowed root", async () => {
    if (!SandboxManager.isSupportedPlatform()) {
      console.warn(`skip: sandbox-runtime backend is not supported on ${process.platform}`);
      return;
    }
    if (spawnSync("rg", ["--version"], { stdio: "ignore" }).status !== 0) {
      console.warn("skip: ripgrep is not available");
      return;
    }

    const root = await mkdtemp(path.join(tmpdir(), "psg-srt-grep-"));
    const publicDir = path.join(root, "public");
    const deniedDir = path.join(root, "denied");
    await mkdir(publicDir);
    await mkdir(deniedDir);
    await writeFile(path.join(publicDir, "visible.txt"), "needle visible", "utf-8");
    await writeFile(path.join(deniedDir, "secret.txt"), "needle secret", "utf-8");

    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [deniedDir], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["grep"], bypass: { mode: "deny" } },
    });
    const sandbox = new SandboxSession();
    try {
      await sandbox.initialize(config.sandboxRuntime);
    } catch (error) {
      console.warn(`skip: sandbox-runtime initialize failed: ${error instanceof Error ? error.message : String(error)}`);
      await sandbox.reset();
      return;
    }

    try {
      const tool = createGrepTool(() => makeServices(config, { sandbox }));
      const text = toolText(
        await tool.execute("call-1", { pattern: "needle", path: root, literal: true }, undefined, undefined, fakeExtensionContext(root)),
      );

      expect(text).toContain("visible.txt");
      expect(text).toContain("needle visible");
      expect(text).not.toContain("secret.txt");
      expect(text).not.toContain("needle secret");
    } finally {
      await sandbox.reset();
    }
  });
});
