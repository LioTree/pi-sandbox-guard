import { describe, expect, it, vi } from "vitest";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { ensureSandboxTempWriteDirs, SandboxSession, type SandboxManagerLike } from "../../../src/runtime/sandbox-session";
import { SandboxExecError } from "../../../src/errors";

const baseConfig: SandboxRuntimeConfig = {
  network: { allowedDomains: [], deniedDomains: [] },
  filesystem: { denyRead: [], allowWrite: ["/tmp/claude", "/private/tmp/claude"], denyWrite: [] },
};

describe("SandboxSession temp write dirs", () => {
  it("creates only platform-relevant sandbox temp write dirs from allowWrite", async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined);

    await ensureSandboxTempWriteDirs(baseConfig, "linux", mkdir);
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(mkdir).toHaveBeenCalledWith("/tmp/claude", { recursive: true, mode: 0o700 });

    mkdir.mockClear();
    await ensureSandboxTempWriteDirs(baseConfig, "darwin", mkdir);
    expect(mkdir).toHaveBeenCalledTimes(2);
    expect(mkdir).toHaveBeenCalledWith("/tmp/claude", { recursive: true, mode: 0o700 });
    expect(mkdir).toHaveBeenCalledWith("/private/tmp/claude", { recursive: true, mode: 0o700 });
  });

  it("does not create temp dirs that are not in allowWrite", async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined);
    await ensureSandboxTempWriteDirs(
      { ...baseConfig, filesystem: { ...baseConfig.filesystem, allowWrite: ["."] } },
      "linux",
      mkdir,
    );
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("fails closed before initializing sandbox-runtime when temp dir creation fails", async () => {
    const manager = fakeManager();
    const ensureTempWriteDirs = vi.fn().mockRejectedValue(new SandboxExecError("cannot create temp dir"));
    const sandbox = new SandboxSession(manager, true, ensureTempWriteDirs);

    await expect(sandbox.initialize(baseConfig)).rejects.toThrow("cannot create temp dir");
    expect(manager.initialize).not.toHaveBeenCalled();
  });
});

function fakeManager(): SandboxManagerLike {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    wrapWithSandboxArgv: vi.fn(),
    annotateStderrWithSandboxFailures: vi.fn(),
    cleanupAfterCommand: vi.fn(),
    reset: vi.fn().mockResolvedValue(undefined),
    isSupportedPlatform: vi.fn(() => true),
  };
}
