import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { runSandboxedCommand } from "../../src/runtime/command-runner";
import { SandboxSession } from "../../src/runtime/sandbox-session";
import { loadRecommendedConfig, materializeRecommendedConfig, sh } from "../recommended-config-helpers";

describe("macOS recommended config sandbox integration", () => {
  it("enforces recursive recommended write denies while allowing normal git data", async () => {
    if (!isMacSandboxSupported()) return;

    const root = await mkdtemp(path.join(tmpdir(), "psg-rec-macos-"));
    const sandbox = new SandboxSession();
    try {
      await setupMacFixture(root);
      await initializeRecommendedSandbox(sandbox, root);

      for (const envPath of [path.join(root, ".env"), path.join(root, "nested", ".env")]) {
        const result = await runSandboxedCommand(sandbox, `cat ${sh(envPath)}`, { cwd: root });
        expect(result.exitCode, `${envPath} should not be readable`).not.toBe(0);
        expect(result.stdout).not.toContain("PI_SANDBOX_SECRET");
      }

      const futureEnv = await runSandboxedCommand(
        sandbox,
        `mkdir -p ${sh(path.join(root, "future"))} && printf PI_SANDBOX_SECRET=future > ${sh(path.join(root, "future", ".env"))} && cat ${sh(path.join(root, "future", ".env"))}`,
        { cwd: root },
      );
      expect(futureEnv.exitCode).not.toBe(0);
      expect(futureEnv.stdout).not.toContain("PI_SANDBOX_SECRET");

      for (const target of [
        "nested/.git/hooks/pre-commit",
        "nested/.git/config",
        "nested/.claude/settings.json",
        "nested/.claude/commands/check.md",
        "nested/.codex/config.toml",
        "nested/.opencode/plugin.js",
        "nested/.pi/extensions/check.ts",
        "nested/opencode.json",
      ]) {
        await expectWriteFails(sandbox, root, target);
      }

      await expectWriteSucceeds(sandbox, root, "src/ok.txt");
      await expectWriteSucceeds(sandbox, root, ".git/index");
    } finally {
      await sandbox.reset();
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function setupMacFixture(root: string): Promise<void> {
  await mkdir(path.join(root, "nested"), { recursive: true });
  await writeFile(path.join(root, ".env"), "PI_SANDBOX_SECRET=root\n", "utf-8");
  await writeFile(path.join(root, "nested", ".env"), "PI_SANDBOX_SECRET=nested\n", "utf-8");
  await mkdir(path.join(root, ".git", "objects"), { recursive: true });
  await mkdir(path.join(root, ".git", "refs"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
}

async function initializeRecommendedSandbox(sandbox: SandboxSession, root: string): Promise<void> {
  const raw = await loadRecommendedConfig("macos");
  const config = materializeRecommendedConfig(raw, root);
  await sandbox.initialize(config.sandbox);
}

async function expectWriteFails(sandbox: SandboxSession, root: string, relativePath: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  const command = `mkdir -p ${sh(path.dirname(absolutePath))} && printf blocked > ${sh(absolutePath)}`;
  const result = await runSandboxedCommand(sandbox, command, { cwd: root });
  expect(result.exitCode, `${relativePath} should not be writable`).not.toBe(0);
}

async function expectWriteSucceeds(sandbox: SandboxSession, root: string, relativePath: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  const result = await runSandboxedCommand(sandbox, `printf allowed > ${sh(absolutePath)}`, { cwd: root });
  expect(result.exitCode, `${relativePath} should be writable`).toBe(0);
  await expect(readFile(absolutePath, "utf-8")).resolves.toBe("allowed");
}

function isMacSandboxSupported(): boolean {
  if (process.platform !== "darwin") {
    console.warn(`skip: macOS recommended config sandbox test on ${process.platform}`);
    return false;
  }
  if (!SandboxManager.isSupportedPlatform()) {
    console.warn("skip: sandbox-runtime backend is not supported on macOS");
    return false;
  }
  return true;
}
