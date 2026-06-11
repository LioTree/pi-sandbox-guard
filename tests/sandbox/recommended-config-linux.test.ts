import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { runSandboxedCommand } from "../../src/runtime/command-runner";
import { SandboxSession } from "../../src/runtime/sandbox-session";
import { loadRecommendedConfig, materializeRecommendedConfig, sh } from "../recommended-config-helpers";

const deniedWriteTargets = [
  ".gitconfig",
  ".gitmodules",
  ".bashrc",
  ".bash_profile",
  ".zshrc",
  ".zprofile",
  ".profile",
  ".ripgreprc",
  ".mcp.json",
  ".vscode/settings.json",
  ".idea/workspace.xml",
  ".git/hooks/pre-commit",
  ".git/config",
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".claude/commands/check.md",
  ".claude/agents/check.md",
  ".codex/config.toml",
  ".opencode/plugin.js",
  ".pi/extensions/check.ts",
  "opencode.json",
];

describe("Linux recommended config sandbox integration", () => {
  it("includes only the Linux sandbox temp write directory", async () => {
    const raw = await loadRecommendedConfig("linux");
    expect(raw.sandbox.filesystem.allowWrite).toContain("/tmp/claude");
    expect(raw.sandbox.filesystem.allowWrite).not.toContain("/private/tmp/claude");
  });

  it("enforces read and write protection without blocking normal git data", async () => {
    if (!isLinuxSandboxSupported()) return;

    const root = await mkdtemp(path.join(tmpdir(), "psg-rec-linux-"));
    const sandbox = new SandboxSession();
    try {
      await setupLinuxFixture(root);
      await initializeRecommendedSandbox(sandbox, root);

      const rootEnv = path.join(root, ".env");
      const nestedEnv = path.join(root, "nested", ".env");
      for (const envPath of [rootEnv, nestedEnv]) {
        const result = await runSandboxedCommand(sandbox, `cat ${sh(envPath)}`, { cwd: root });
        expect(result.exitCode, `${envPath} should not be readable`).not.toBe(0);
        expect(result.stdout).not.toContain("PI_SANDBOX_SECRET");
      }

      for (const target of deniedWriteTargets) {
        await expectWriteFails(sandbox, root, target);
      }

      await expectWriteSucceeds(sandbox, root, "src/ok.txt");
      await expectWriteSucceeds(sandbox, root, ".git/index");
    } finally {
      await sandbox.reset();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not leave ghost mount point files for missing protected paths", async () => {
    if (!isLinuxSandboxSupported()) return;

    const root = await mkdtemp(path.join(tmpdir(), "psg-rec-linux-cleanup-"));
    const sandbox = new SandboxSession();
    try {
      await initializeRecommendedSandbox(sandbox, root);
      const result = await runSandboxedCommand(sandbox, "true", { cwd: root });
      expect(result.exitCode).toBe(0);
    } finally {
      await sandbox.reset();
    }

    for (const missingPath of [".bashrc", ".gitconfig", ".vscode", ".idea", ".claude", ".codex", ".opencode", ".pi"]) {
      expect(existsSync(path.join(root, missingPath)), `${missingPath} should not remain after cleanup`).toBe(false);
    }

    await rm(root, { recursive: true, force: true });
  });
});

async function setupLinuxFixture(root: string): Promise<void> {
  await mkdir(path.join(root, "nested"), { recursive: true });
  await writeFile(path.join(root, ".env"), "PI_SANDBOX_SECRET=root\n", "utf-8");
  await writeFile(path.join(root, "nested", ".env"), "PI_SANDBOX_SECRET=nested\n", "utf-8");

  await writeFile(path.join(root, "public.txt"), "ok", "utf-8");
  for (const target of deniedWriteTargets) {
    const absolutePath = path.join(root, target);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, "initial", "utf-8");
  }

  await mkdir(path.join(root, ".git", "objects"), { recursive: true });
  await mkdir(path.join(root, ".git", "refs"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
}

async function initializeRecommendedSandbox(sandbox: SandboxSession, root: string): Promise<void> {
  const raw = await loadRecommendedConfig("linux");
  const config = materializeRecommendedConfig(raw, root);
  await sandbox.initialize(config.sandbox);
}

async function expectWriteFails(sandbox: SandboxSession, root: string, relativePath: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  const result = await runSandboxedCommand(sandbox, `printf blocked > ${sh(absolutePath)}`, { cwd: root });
  expect(result.exitCode, `${relativePath} should not be writable`).not.toBe(0);
}

async function expectWriteSucceeds(sandbox: SandboxSession, root: string, relativePath: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  const result = await runSandboxedCommand(sandbox, `printf allowed > ${sh(absolutePath)}`, { cwd: root });
  expect(result.exitCode, `${relativePath} should be writable`).toBe(0);
  await expect(readFile(absolutePath, "utf-8")).resolves.toBe("allowed");
}

function isLinuxSandboxSupported(): boolean {
  if (process.platform !== "linux") {
    console.warn(`skip: Linux recommended config sandbox test on ${process.platform}`);
    return false;
  }
  if (!SandboxManager.isSupportedPlatform()) {
    console.warn("skip: sandbox-runtime backend is not supported on Linux");
    return false;
  }
  return true;
}
