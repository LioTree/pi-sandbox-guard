import { mkdtemp } from "node:fs/promises";
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
      { command: "printf sandboxed" },
      undefined,
      undefined,
      fakeExtensionContext(root),
    );

    const text = result.content.find((item) => item.type === "text")?.text ?? "";
    expect(text).toContain("sandboxed");
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
});

function fakeExtensionContext(cwd: string): any {
  return {
    cwd,
    ui: {},
    sessionManager: { getEntries: () => [] },
  };
}
