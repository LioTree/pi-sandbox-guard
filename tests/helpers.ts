import path from "node:path";
import { compileEffectiveConfig } from "../src/config/compile";
import type { EffectiveConfig, RawGuardConfig } from "../src/config/effective";
import { ReviewService } from "../src/review/service";
import type { Services } from "../src/runtime-state";
import { SandboxSession, type SandboxManagerLike } from "../src/runtime/sandbox-session";

type RawConfigOverrides = Omit<Partial<RawGuardConfig>, "sandbox" | "enforcement"> & {
  sandbox?: {
    network?: {
      allowedDomains?: string[];
      deniedDomains?: string[];
    };
    filesystem?: {
      denyRead?: string[];
      allowRead?: string[];
      allowWrite?: string[];
      denyWrite?: string[];
    };
  };
  enforcement?: {
    tools?: RawGuardConfig["enforcement"]["tools"];
    bypass?: Partial<RawGuardConfig["enforcement"]["bypass"]>;
  };
};

export function rawConfig(
  cwd: string,
  overrides: RawConfigOverrides = {},
): RawGuardConfig {
  const base: RawGuardConfig = {
    enabled: true,
    sandbox: {
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [cwd], denyWrite: [] },
    },
    enforcement: {
      tools: ["bash", "read", "write", "edit", "grep", "find", "ls"],
      bypass: { mode: "deny" },
    },
  };
  return {
    ...base,
    ...overrides,
    sandbox: {
      ...base.sandbox,
      ...overrides.sandbox,
      filesystem: {
        ...base.sandbox.filesystem,
        ...overrides.sandbox?.filesystem,
      },
      network: {
        ...base.sandbox.network,
        ...overrides.sandbox?.network,
      },
    },
    enforcement: {
      ...base.enforcement,
      ...overrides.enforcement,
      bypass: {
        ...base.enforcement.bypass,
        ...overrides.enforcement?.bypass,
      },
    },
  };
}

export function effectiveConfig(
  cwd: string,
  overrides: RawConfigOverrides = {},
): EffectiveConfig {
  return compileEffectiveConfig(rawConfig(cwd, overrides), path.join(cwd, ".pi", "sandbox-guard.json"), cwd);
}

export function makeServices(config: EffectiveConfig, overrides: Partial<Services> = {}): Services {
  return {
    config,
    sandbox: new SandboxSession(fakeSandboxManager()),
    reviewer: new ReviewService({
      async review() {
        throw new Error("reviewer should not run");
      },
    }),
    audit: () => {},
    ...overrides,
  };
}

export function fakeSandboxManager(overrides: Partial<SandboxManagerLike> = {}): SandboxManagerLike {
  return {
    initialize: async () => {},
    wrapWithSandboxArgv: async (command: string) => ({
      argv: [process.env.SHELL ?? "sh", "-lc", command],
      env: {},
    }),
    annotateStderrWithSandboxFailures: (_command: string, stderr: string) => stderr,
    cleanupAfterCommand: () => {},
    reset: async () => {},
    isSupportedPlatform: () => true,
    ...overrides,
  };
}

export function fakeExtensionContext(cwd: string): any {
  return {
    cwd,
    ui: {},
    sessionManager: { getEntries: () => [] },
  };
}

export function toolText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.find((item) => item.type === "text")?.text ?? "";
}
