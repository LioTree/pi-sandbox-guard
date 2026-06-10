import { spawn } from "node:child_process";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { appendChunk, appendChunkTail } from "./process-output";
import type { SandboxSession } from "./sandbox-session";
import { SandboxExecError, errorMessage } from "../errors";
import type { AuditSink } from "../audit";

export type CommandRunOptions = {
  cwd: string;
  timeout?: number;
  signal?: AbortSignal;
  onData?: (data: Buffer) => void;
  sandboxConfig?: Partial<SandboxRuntimeConfig>;
  maxCapturedOutputBytes?: number;
  sandboxCommand?: string;
  env?: NodeJS.ProcessEnv;
};

export const SANDBOX_COMMAND_ENV = "PI_SANDBOX_GUARD_COMMAND";

export function sandboxCommandFromEnv(command: string): Pick<CommandRunOptions, "sandboxCommand" | "env"> {
  return {
    sandboxCommand: `bash -c 'eval "$${SANDBOX_COMMAND_ENV}"'`,
    env: { [SANDBOX_COMMAND_ENV]: command },
  };
}

export type StreamingCommandRunOptions = CommandRunOptions & {
  onStdout?: (data: Buffer, control: StreamingCommandControl) => void;
  onStderr?: (data: Buffer, control: StreamingCommandControl) => void;
};

export type StreamingCommandControl = {
  stop(): void;
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
  const sandboxCommand = options.sandboxCommand ?? command;
  let prepared: Awaited<ReturnType<SandboxSession["prepareCommand"]>>;
  try {
    prepared = await sandbox.prepareCommand(sandboxCommand, {
      abortSignal: options.signal,
      customConfig: options.sandboxConfig,
    });
  } catch (error) {
    throw new SandboxExecError(`failed to wrap command with sandbox: ${errorMessage(error)}`, error);
  }

  try {
    const result = await spawnCommand(prepared.argv, {
      ...options,
      env: { ...process.env, ...prepared.env, ...options.env },
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
      prepared.finish();
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
    env: { ...process.env, ...options.env },
  });
}

export async function runSandboxedStreamingCommand(
  sandbox: SandboxSession,
  command: string,
  options: StreamingCommandRunOptions,
  audit?: AuditSink,
): Promise<CommandRunResult> {
  const sandboxCommand = options.sandboxCommand ?? command;
  let prepared: Awaited<ReturnType<SandboxSession["prepareCommand"]>>;
  try {
    prepared = await sandbox.prepareCommand(sandboxCommand, {
      abortSignal: options.signal,
      customConfig: options.sandboxConfig,
    });
  } catch (error) {
    throw new SandboxExecError(`failed to wrap command with sandbox: ${errorMessage(error)}`, error);
  }

  try {
    const result = await spawnCommand(prepared.argv, {
      ...options,
      env: { ...process.env, ...prepared.env, ...options.env },
    });
    const annotatedStderr = sandbox.annotateStderr(command, result.stderr);
    const annotated = annotatedStderr !== result.stderr;
    if (annotated) {
      const suffix = annotatedStderr.slice(result.stderr.length);
      options.onData?.(Buffer.from(suffix));
      options.onStderr?.(Buffer.from(suffix), { stop() {} });
      audit?.({ type: "sandbox_violation_annotation", command, annotated: true });
    }
    audit?.({ type: "sandbox_command_exit", command, cwd: options.cwd, exitCode: result.exitCode });
    return { ...result, stderr: annotatedStderr };
  } finally {
    try {
      prepared.finish();
    } catch (error) {
      throw new SandboxExecError(`sandbox cleanup failed: ${errorMessage(error)}`, error);
    }
  }
}

async function spawnCommand(
  argv: string[],
  options: StreamingCommandRunOptions & { env: NodeJS.ProcessEnv },
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
    const control: StreamingCommandControl = { stop: kill };

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
      stdout =
        options.maxCapturedOutputBytes === undefined
          ? appendChunk(stdout, chunk)
          : appendChunkTail(stdout, chunk, options.maxCapturedOutputBytes);
      options.onData?.(chunk);
      options.onStdout?.(chunk, control);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr =
        options.maxCapturedOutputBytes === undefined
          ? appendChunk(stderr, chunk)
          : appendChunkTail(stderr, chunk, options.maxCapturedOutputBytes);
      options.onData?.(chunk);
      options.onStderr?.(chunk, control);
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
