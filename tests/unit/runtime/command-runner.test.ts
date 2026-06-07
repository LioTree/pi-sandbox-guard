import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SandboxExecError } from "../../../src/errors";
import { runSandboxedCommand } from "../../../src/runtime/command-runner";
import { SandboxSession } from "../../../src/runtime/sandbox-session";
import { fakeSandboxManager } from "../../helpers";

describe("runSandboxedCommand", () => {
  it("uses the sandbox wrapper and cleans up after a successful command", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-command-"));
    let wrappedCommand = "";
    let cleanupCount = 0;
    const sandbox = new SandboxSession(
      fakeSandboxManager({
        wrapWithSandboxArgv: async (command: string) => {
          wrappedCommand = command;
          return { argv: [process.env.SHELL ?? "sh", "-lc", command], env: { PSG_TEST_ENV: "yes" } };
        },
        cleanupAfterCommand: () => {
          cleanupCount++;
        },
      }),
    );
    await sandbox.initialize({ network: { allowedDomains: [], deniedDomains: [] }, filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } });

    const result = await runSandboxedCommand(sandbox, "printf $PSG_TEST_ENV", { cwd: root });

    expect(wrappedCommand).toBe("printf $PSG_TEST_ENV");
    expect(result.stdout).toBe("yes");
    expect(cleanupCount).toBe(1);
  });

  it("cleans up after command failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-command-"));
    let cleanupCount = 0;
    const sandbox = new SandboxSession(
      fakeSandboxManager({
        cleanupAfterCommand: () => {
          cleanupCount++;
        },
      }),
    );
    await sandbox.initialize({ network: { allowedDomains: [], deniedDomains: [] }, filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } });

    const result = await runSandboxedCommand(sandbox, "exit 7", { cwd: root });

    expect(result.exitCode).toBe(7);
    expect(cleanupCount).toBe(1);
  });

  it("annotates sandbox violation stderr and emits audit metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-command-"));
    const auditEvents: unknown[] = [];
    const sandbox = new SandboxSession(
      fakeSandboxManager({
        annotateStderrWithSandboxFailures: (_command: string, stderr: string) => `${stderr}[annotated]`,
      }),
    );
    await sandbox.initialize({ network: { allowedDomains: [], deniedDomains: [] }, filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } });

    const result = await runSandboxedCommand(
      sandbox,
      "printf denied >&2",
      { cwd: root },
      (event) => auditEvents.push(event),
    );

    expect(result.stderr).toBe("denied[annotated]");
    expect(auditEvents).toContainEqual({ type: "sandbox_violation_annotation", command: "printf denied >&2", annotated: true });
    expect(auditEvents).toContainEqual({ type: "sandbox_command_exit", command: "printf denied >&2", cwd: root, exitCode: 0 });
  });

  it("fails closed when cleanup fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-command-"));
    const sandbox = new SandboxSession(
      fakeSandboxManager({
        cleanupAfterCommand: () => {
          throw new Error("cleanup failed");
        },
      }),
    );
    await sandbox.initialize({ network: { allowedDomains: [], deniedDomains: [] }, filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } });

    await expect(runSandboxedCommand(sandbox, "true", { cwd: root })).rejects.toThrow(SandboxExecError);
  });
});
