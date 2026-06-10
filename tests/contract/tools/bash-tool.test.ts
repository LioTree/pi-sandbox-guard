import { readFile, stat, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileEffectiveConfig } from "../../../src/config/compile";
import type { Services } from "../../../src/runtime-state";
import { ReviewDeniedError } from "../../../src/errors";
import { ReviewService } from "../../../src/review/service";
import { SandboxSession } from "../../../src/runtime/sandbox-session";
import { createBashTool } from "../../../src/tools/adapters/bash";
import { fakeSandboxManager } from "../../helpers";

describe("bash tool contract", () => {
  it("runs normal commands through sandboxed execution without reviewer", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-bash-tool-"));
    const config = compileEffectiveConfig(
      {
        enabled: true,
        sandbox: {
          network: { allowedDomains: [], deniedDomains: [] },
          filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] },
        },
        enforcement: {
          tools: ["bash"],
          bypass: { mode: "review" },
        },
        reviewer: { enabled: true, timeoutMs: 1_000, maxTranscriptTokens: 1_000 },
      },
      path.join(root, ".pi", "sandbox-guard.json"),
      root,
    );
    let wrapCalls = 0;
    const sandbox = new SandboxSession(
      fakeSandboxManager({
        wrapWithSandboxArgv: async (command: string) => {
          wrapCalls++;
          return { argv: [process.env.SHELL ?? "sh", "-lc", command], env: {} };
        },
      }),
    );
    await sandbox.initialize(config.sandboxRuntime);
    const services: Services = {
      config,
      sandbox,
      reviewer: new ReviewService({
        async review() {
          throw new Error("reviewer should not run");
        },
      }),
      audit: () => {},
    };
    const tool = createBashTool(() => services);

    const result = await tool.execute(
      "call-1",
      { command: "printf sandboxed" },
      undefined,
      undefined,
      fakeExtensionContext(root),
    );

    const text = result.content.find((item) => item.type === "text")?.text ?? "";
    expect(text).toContain("sandboxed");
    expect(wrapCalls).toBe(1);
  });

  it("does not feed the command script to child process stdin", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-bash-tool-"));
    const config = compileEffectiveConfig(
      {
        enabled: true,
        sandbox: {
          network: { allowedDomains: [], deniedDomains: [] },
          filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] },
        },
        enforcement: {
          tools: ["bash"],
          bypass: { mode: "deny" },
        },
      },
      path.join(root, ".pi", "sandbox-guard.json"),
      root,
    );
    const sandbox = new SandboxSession(fakeSandboxManager());
    await sandbox.initialize(config.sandboxRuntime);
    const services: Services = {
      config,
      sandbox,
      reviewer: new ReviewService({
        async review() {
          throw new Error("reviewer should not run");
        },
      }),
      audit: () => {},
    };
    const tool = createBashTool(() => services);

    const result = await tool.execute(
      "call-1",
      { command: "cat\necho after-stdin-reader" },
      undefined,
      undefined,
      fakeExtensionContext(root),
    );

    const text = result.content.find((item) => item.type === "text")?.text ?? "";
    expect(text).toContain("after-stdin-reader");
  });

  it("passes the effective sandbox runtime config into sandboxed command execution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-bash-tool-"));
    const config = compileEffectiveConfig(
      {
        enabled: true,
        sandbox: {
          network: { allowedDomains: [], deniedDomains: [] },
          filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] },
        },
        enforcement: {
          tools: ["bash"],
          bypass: { mode: "deny" },
        },
      },
      path.join(root, ".pi", "sandbox-guard.json"),
      root,
    );
    let capturedConfig: unknown;
    const sandbox = new SandboxSession(
      fakeSandboxManager({
        wrapWithSandboxArgv: async (command: string, _binShell?: string, customConfig?: unknown) => {
          capturedConfig = customConfig;
          return { argv: [process.env.SHELL ?? "sh", "-lc", command], env: {} };
        },
      }),
    );
    await sandbox.initialize(config.sandboxRuntime);
    const services: Services = {
      config,
      sandbox,
      reviewer: new ReviewService({
        async review() {
          throw new Error("reviewer should not run");
        },
      }),
      audit: () => {},
    };
    const tool = createBashTool(() => services);

    await tool.execute("call-1", { command: "true" }, undefined, undefined, fakeExtensionContext(root));

    expect(capturedConfig).toEqual(config.sandboxRuntime);
  });

  it("routes explicit bypass through reviewer and fails closed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-bash-tool-"));
    const config = compileEffectiveConfig(
      {
        enabled: true,
        sandbox: {
          network: { allowedDomains: [], deniedDomains: [] },
          filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] },
        },
        enforcement: {
          tools: ["bash"],
          bypass: { mode: "review" },
        },
        reviewer: { enabled: true, timeoutMs: 1_000, maxTranscriptTokens: 1_000 },
      },
      path.join(root, ".pi", "sandbox-guard.json"),
      root,
    );
    const services: Services = {
      config,
      sandbox: new SandboxSession(fakeSandboxManager()),
      reviewer: new ReviewService({
        async review() {
          throw new ReviewDeniedError("denied by fake reviewer");
        },
      }),
      audit: () => {},
    };
    const tool = createBashTool(() => services);

    await expect(
      tool.execute(
        "call-1",
        { command: "echo should-not-run", bypassSandbox: true },
        undefined,
        undefined,
        fakeExtensionContext(root),
      ),
    ).rejects.toThrow(/denied by fake reviewer/);
  });

  it("truncates large bash output from the tail and saves full output metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-bash-tool-"));
    const config = compileEffectiveConfig(
      {
        enabled: true,
        sandbox: {
          network: { allowedDomains: [], deniedDomains: [] },
          filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] },
        },
        enforcement: {
          tools: ["bash"],
          bypass: { mode: "deny" },
        },
      },
      path.join(root, ".pi", "sandbox-guard.json"),
      root,
    );
    config.toolOutput.maxLines = 3;
    config.toolOutput.maxBytes = 10_000;
    config.toolOutput.fullOutputDir = root;
    const sandbox = new SandboxSession(fakeSandboxManager());
    await sandbox.initialize(config.sandboxRuntime);
    const services: Services = {
      config,
      sandbox,
      audit: () => {},
    };
    const tool = createBashTool(() => services);

    const result = await tool.execute(
      "call-1",
      { command: "printf 'one\\ntwo\\nthree\\nfour\\nfive\\n'" },
      undefined,
      undefined,
      fakeExtensionContext(root),
    );

    const text = result.content.find((item) => item.type === "text")?.text ?? "";
    expect(text).not.toContain("one");
    expect(text).not.toContain("two");
    expect(text).toContain("three");
    expect(text).toContain("five");
    expect(text).toContain("Showing lines 3-5 of 5");
    const fullOutputPath = (result.details as { fullOutputPath?: string } | undefined)?.fullOutputPath;
    expect(fullOutputPath).toBeDefined();
    expect(await readFile(fullOutputPath!, "utf-8")).toBe("one\ntwo\nthree\nfour\nfive\n");
    expect((await stat(fullOutputPath!)).mode & 0o777).toBe(0o600);
  });
});

function fakeExtensionContext(cwd: string): any {
  return {
    cwd,
    ui: {},
    sessionManager: { getEntries: () => [] },
  };
}
