import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileEffectiveConfig } from "../../../src/config/compile";
import type { Services } from "../../../src/runtime-state";
import { ReviewService } from "../../../src/review/service";
import { SandboxSession } from "../../../src/runtime/sandbox-session";
import { createReadTool } from "../../../src/tools/adapters/read";

describe("read tool contract", () => {
  it("enters policy before reading the filesystem", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-read-tool-"));
    const denied = path.join(root, "denied.txt");
    await writeFile(denied, "secret", "utf-8");

    const config = compileEffectiveConfig(
      {
        enabled: true,
        sandbox: {
          network: { allowedDomains: [], deniedDomains: [] },
          filesystem: { denyRead: [denied], allowWrite: [root], denyWrite: [] },
        },
        enforcement: {
          tools: ["read"],
          bypass: { mode: "deny" },
        },
      },
      path.join(root, ".pi", "sandbox-guard.json"),
      root,
    );

    const services: Services = {
      config,
      sandbox: new SandboxSession(fakeSandboxManager()),
      reviewer: new ReviewService({
        async review() {
          throw new Error("reviewer should not run");
        },
      }),
      audit: () => {},
    };
    const tool = createReadTool(() => services);

    await expect(
      tool.execute("call-1", { path: denied }, undefined, undefined, fakeExtensionContext(root)),
    ).rejects.toThrow(/read denied/);
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
