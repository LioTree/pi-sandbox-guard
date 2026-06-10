import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { describe, expect, it } from "vitest";
import { SandboxSession } from "../../src/runtime/sandbox-session";
import { createBashTool } from "../../src/tools/adapters/bash";
import { effectiveConfig, fakeExtensionContext, makeServices, toolText } from "../helpers";

describe("bash tool sandbox integration", () => {
  it("preserves ripgrep ! glob exclusions in sandboxed bash", async () => {
    if (!SandboxManager.isSupportedPlatform()) {
      console.warn(`skip: sandbox-runtime backend is not supported on ${process.platform}`);
      return;
    }
    if (spawnSync("rg", ["--version"], { stdio: "ignore" }).status !== 0) {
      console.warn("skip: ripgrep is not available");
      return;
    }

    const root = await mkdtemp(path.join(tmpdir(), "psg-srt-bash-"));
    const packageDir = path.join(root, "node_modules", "@earendil-works", "pi-coding-agent");
    const distDir = path.join(packageDir, "dist");
    await mkdir(distDir, { recursive: true });
    await writeFile(path.join(distDir, "index.js"), "export function createLsToolDefinition() {}\n", "utf-8");
    await writeFile(path.join(distDir, "index.js.map"), "createFindToolDefinition createGrepToolDefinition\n", "utf-8");

    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["bash"], bypass: { mode: "deny" } },
    });
    const sandbox = new SandboxSession(undefined, false);
    try {
      await sandbox.initialize(config.sandboxRuntime);
    } catch (error) {
      console.warn(`skip: sandbox-runtime initialize failed: ${error instanceof Error ? error.message : String(error)}`);
      await sandbox.reset();
      return;
    }

    try {
      const tool = createBashTool(() => makeServices(config, { sandbox }));
      const result = await tool.execute(
        "call-1",
        {
          command: `rg -n "createLsToolDefinition|createFindToolDefinition|createGrepToolDefinition" ${sh(packageDir)} -g '!**/*.map'`,
        },
        undefined,
        undefined,
        fakeExtensionContext(root),
      );
      const text = toolText(result);

      expect(text).toContain("createLsToolDefinition");
      expect(text).toContain("index.js");
      expect(text).not.toContain("index.js.map");
    } finally {
      await sandbox.reset();
    }
  });
});

function sh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
