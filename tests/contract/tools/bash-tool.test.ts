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

describe("bash tool contract", () => {
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
        reviewer: { enabled: true, timeoutMs: 1_000, maxTranscriptChars: 1_000 },
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

function fakeSandboxManager(): any {
  return {
    initialize: async () => {},
    wrapWithSandboxArgv: async () => ({ argv: ["true"], env: {} }),
    annotateStderrWithSandboxFailures: (_command: string, stderr: string) => stderr,
    cleanupAfterCommand: () => {},
    reset: async () => {},
    isSupportedPlatform: () => true,
  };
}

function fakeExtensionContext(cwd: string): any {
  return {
    cwd,
    ui: {},
    sessionManager: { getEntries: () => [] },
  };
}
