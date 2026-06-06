import { spawn } from "node:child_process";
import { appendChunk } from "./process-output";
import type { SandboxSession } from "./sandbox-session";
import { SandboxExecError, errorMessage } from "../errors";
import type { AuditSink } from "../audit";

export type CommandRunOptions = {
  cwd: string;
  timeout?: number;
  signal?: AbortSignal;
  onData?: (data: Buffer) => void;
};

export type CommandRunResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export async function runSandboxedCommand(
  sandbox: SandboxSession,
  command: string,
  options: CommandRunOptions,
  audit?: AuditSink,
): Promise<CommandRunResult> {
  let argv: string[];
  let env: NodeJS.ProcessEnv;
  try {
    const wrapped = await sandbox.wrapArgv(command, options.signal);
    argv = wrapped.argv;
    env = wrapped.env;
  } catch (error) {
    throw new SandboxExecError(`failed to wrap command with sandbox: ${errorMessage(error)}`, error);
  }

  try {
    const result = await spawnCommand(argv, {
      ...options,
      env: { ...process.env, ...env },
    });
    const annotatedStderr = sandbox.annotateStderr(command, result.stderr);
    const annotated = annotatedStderr !== result.stderr;
    if (annotated) {
      options.onData?.(Buffer.from(annotatedStderr.slice(result.stderr.length)));
      audit?.({ type: "sandbox_violation_annotation", command, annotated: true });
    }
    audit?.({ type: "sandbox_command_exit", command, cwd: options.cwd, exitCode: result.exitCode });
    return { ...result, stderr: annotatedStderr };
  } finally {
    try {
      sandbox.cleanupAfterCommand();
    } catch (error) {
      throw new SandboxExecError(`sandbox cleanup failed: ${errorMessage(error)}`, error);
    }
  }
}

export async function runNativeCommand(command: string, options: CommandRunOptions): Promise<CommandRunResult> {
  const shell = process.platform === "win32" ? "cmd.exe" : (process.env.SHELL ?? "bash");
  const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
  return spawnCommand([shell, ...args], {
    ...options,
    env: { ...process.env },
  });
}

async function spawnCommand(
  argv: string[],
  options: CommandRunOptions & { env: NodeJS.ProcessEnv },
): Promise<CommandRunResult> {
  return new Promise((resolve, reject) => {
    if (argv.length === 0) {
      reject(new SandboxExecError("sandbox wrapper returned empty argv"));
      return;
    }
    if (options.signal?.aborted) {
      reject(new SandboxExecError("command aborted"));
      return;
    }

    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const kill = () => {
      if (!child.pid) {
        return;
      }
      try {
        if (process.platform !== "win32") {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        child.kill("SIGKILL");
      }
    };

    const onAbort = () => {
      kill();
    };

    if (options.timeout !== undefined && options.timeout > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        kill();
      }, options.timeout * 1000);
    }

    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendChunk(stdout, chunk);
      options.onData?.(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendChunk(stderr, chunk);
      options.onData?.(chunk);
    });

    child.on("error", (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      options.signal?.removeEventListener("abort", onAbort);
      reject(new SandboxExecError(`command spawn failed: ${error.message}`, error));
    });

    child.on("close", (exitCode) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      options.signal?.removeEventListener("abort", onAbort);
      if (options.signal?.aborted) {
        reject(new SandboxExecError("command aborted"));
      } else if (timedOut) {
        reject(new SandboxExecError(`command timed out after ${options.timeout} seconds`));
      } else {
        resolve({ exitCode, stdout, stderr });
      }
    });
  });
}
