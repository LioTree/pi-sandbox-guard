import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
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

  constructor(
    private readonly manager: SandboxManagerLike = SandboxManager,
    private readonly enableLogMonitor = true,
  ) {}

  async initialize(config: SandboxRuntimeConfig): Promise<void> {
    if (!this.manager.isSupportedPlatform()) {
      throw new SandboxExecError(`sandbox-runtime is not supported on ${process.platform}`);
    }
    await this.manager.initialize(config, undefined, this.enableLogMonitor);
    this.initialized = true;
  }

  async wrapArgv(command: string, abortSignal?: AbortSignal): Promise<{ argv: string[]; env: NodeJS.ProcessEnv }> {
    this.assertInitialized();
    return this.manager.wrapWithSandboxArgv(command, undefined, undefined, abortSignal);
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
    if (!this.initialized) {
      return;
    }
    await this.manager.reset();
    this.initialized = false;
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new SandboxExecError("sandbox session is not initialized");
    }
  }
}
