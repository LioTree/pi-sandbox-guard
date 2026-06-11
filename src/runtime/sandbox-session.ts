import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { mkdir } from "node:fs/promises";
import { SandboxExecError } from "../errors";

export type SandboxManagerLike = Pick<
  typeof SandboxManager,
  | "initialize"
  | "wrapWithSandboxArgv"
  | "annotateStderrWithSandboxFailures"
  | "cleanupAfterCommand"
  | "reset"
  | "isSupportedPlatform"
>;

export class SandboxSession {
  private initialized = false;
  private readonly lifecycle = new AsyncRwLock();

  constructor(
    private readonly manager: SandboxManagerLike = SandboxManager,
    private readonly enableLogMonitor = true,
    private readonly ensureTempWriteDirs: EnsureTempWriteDirs = ensureSandboxTempWriteDirs,
  ) {}

  async initialize(config: SandboxRuntimeConfig): Promise<void> {
    const release = await this.lifecycle.acquireWrite();
    try {
      if (!this.manager.isSupportedPlatform()) {
        throw new SandboxExecError(`sandbox-runtime is not supported on ${process.platform}`);
      }
      await this.ensureTempWriteDirs(config);
      await this.manager.initialize(config, undefined, this.enableLogMonitor);
      this.initialized = true;
    } finally {
      release();
    }
  }

  async prepareCommand(command: string, options: SandboxCommandOptions = {}): Promise<PreparedSandboxCommand> {
    const release = await this.lifecycle.acquireRead();
    let released = false;
    const finish = () => {
      if (released) {
        return;
      }
      released = true;
      try {
        this.cleanupAfterCommand();
      } finally {
        release();
      }
    };

    try {
      this.assertInitialized();
      const wrapped = await this.manager.wrapWithSandboxArgv(
        command,
        undefined,
        options.customConfig,
        options.abortSignal,
      );
      return { ...wrapped, finish };
    } catch (error) {
      release();
      throw error;
    }
  }

  annotateStderr(command: string, stderr: string): string {
    this.assertInitialized();
    return this.manager.annotateStderrWithSandboxFailures(command, stderr);
  }

  cleanupAfterCommand(): void {
    if (!this.initialized) {
      return;
    }
    this.manager.cleanupAfterCommand();
  }

  async reset(): Promise<void> {
    const release = await this.lifecycle.acquireWrite();
    try {
      if (!this.initialized) {
        return;
      }
      await this.manager.reset();
      this.initialized = false;
    } finally {
      release();
    }
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new SandboxExecError("sandbox session is not initialized");
    }
  }
}

export type SandboxCommandOptions = {
  customConfig?: Partial<SandboxRuntimeConfig>;
  abortSignal?: AbortSignal;
};

export type PreparedSandboxCommand = {
  argv: string[];
  env: NodeJS.ProcessEnv;
  finish(): void;
};

type LockRelease = () => void;
type EnsureTempWriteDirs = (config: SandboxRuntimeConfig) => Promise<void>;

export async function ensureSandboxTempWriteDirs(
  config: SandboxRuntimeConfig,
  platform: NodeJS.Platform = process.platform,
  mkdirFn: typeof mkdir = mkdir,
): Promise<void> {
  const allowWrite = new Set(config.filesystem.allowWrite);
  const tempDirs = platform === "darwin" ? ["/tmp/claude", "/private/tmp/claude"] : ["/tmp/claude"];

  for (const dir of tempDirs) {
    if (!allowWrite.has(dir)) continue;
    try {
      await mkdirFn(dir, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw new SandboxExecError(
        `failed to create sandbox temp write directory ${dir}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

class AsyncRwLock {
  private readers = 0;
  private writerActive = false;
  private readonly queue: Array<{
    mode: "read" | "write";
    resolve: (release: LockRelease) => void;
  }> = [];

  acquireRead(): Promise<LockRelease> {
    if (!this.writerActive && !this.hasWaitingWriter()) {
      this.readers++;
      return Promise.resolve(this.createReadRelease());
    }
    return new Promise((resolve) => {
      this.queue.push({ mode: "read", resolve });
    });
  }

  acquireWrite(): Promise<LockRelease> {
    if (!this.writerActive && this.readers === 0 && this.queue.length === 0) {
      this.writerActive = true;
      return Promise.resolve(this.createWriteRelease());
    }
    return new Promise((resolve) => {
      this.queue.push({ mode: "write", resolve });
    });
  }

  private hasWaitingWriter(): boolean {
    return this.queue.some((entry) => entry.mode === "write");
  }

  private createReadRelease(): LockRelease {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.readers--;
      this.drain();
    };
  }

  private createWriteRelease(): LockRelease {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.writerActive = false;
      this.drain();
    };
  }

  private drain(): void {
    if (this.writerActive || this.readers > 0) {
      return;
    }

    const next = this.queue[0];
    if (!next) {
      return;
    }

    if (next.mode === "write") {
      this.queue.shift();
      this.writerActive = true;
      next.resolve(this.createWriteRelease());
      return;
    }

    while (this.queue[0]?.mode === "read") {
      const reader = this.queue.shift();
      if (!reader) {
        return;
      }
      this.readers++;
      reader.resolve(this.createReadRelease());
    }
  }
}
