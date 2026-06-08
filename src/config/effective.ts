import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { CompiledPathPolicy } from "../policy/path-policy";

export const builtinToolNames = ["bash", "read", "write", "edit", "grep", "find", "ls"] as const;

export type BuiltinToolName = (typeof builtinToolNames)[number];

export type BypassMode = "review" | "deny";

export type EnforcementConfig = {
  tools: BuiltinToolName[];
  bypass: {
    mode: BypassMode;
  };
};

export type ReviewerConfig = {
  enabled: boolean;
  timeoutMs: number;
  maxTranscriptTokens: number;
  model?: string;
  thinkingLevel?: string;
};

export type ToolOutputConfig = {
  maxLines: number;
  maxBytes: number;
  grepMaxLineChars: number;
  fullOutputDir: string;
};

export type RawGuardConfig = {
  enabled: boolean;
  sandbox: SandboxRuntimeConfig;
  enforcement: EnforcementConfig;
  reviewer?: ReviewerConfig;
};

export type EffectiveConfig = {
  sourcePath: string;
  cwd: string;
  enabled: boolean;
  sandboxRuntime: SandboxRuntimeConfig;
  enforcement: EnforcementConfig;
  reviewer?: ReviewerConfig;
  toolOutput: ToolOutputConfig;
  pathPolicy: CompiledPathPolicy;
};

export type ConfigLoadResult =
  | { kind: "loaded"; config: EffectiveConfig }
  | { kind: "disabled"; reason: string }
  | { kind: "error"; error: Error };
