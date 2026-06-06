import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { ConfigError } from "../errors";
import { builtinToolNames, type BuiltinToolName, type RawGuardConfig } from "./effective";

const builtinToolNameSet = new Set<string>(builtinToolNames);

export function parseGuardConfig(value: unknown, sourcePath: string): RawGuardConfig {
  const config = requireRecord(value, "config");
  const enabled = requireBoolean(config.enabled, "enabled");
  const sandbox = parseSandboxRuntimeConfig(config.sandbox, "sandbox");
  const enforcement = parseEnforcementConfig(config.enforcement);
  const reviewer = config.reviewer === undefined ? undefined : parseReviewerConfig(config.reviewer);

  if (enforcement.bypass.mode === "review") {
    if (!reviewer?.enabled) {
      throw new ConfigError(`${sourcePath}: reviewer.enabled must be true when enforcement.bypass.mode is "review"`);
    }
  }

  return { enabled, sandbox, enforcement, reviewer };
}

function parseEnforcementConfig(value: unknown): RawGuardConfig["enforcement"] {
  const enforcement = requireRecord(value, "enforcement");
  const tools = requireStringArray(enforcement.tools, "enforcement.tools").map((tool) => {
    if (!builtinToolNameSet.has(tool)) {
      throw new ConfigError(`enforcement.tools contains unsupported tool: ${tool}`);
    }
    return tool as BuiltinToolName;
  });

  const bypass = requireRecord(enforcement.bypass, "enforcement.bypass");
  const mode = requireString(bypass.mode, "enforcement.bypass.mode");
  if (mode !== "review" && mode !== "deny") {
    throw new ConfigError('enforcement.bypass.mode must be "review" or "deny"');
  }

  return { tools, bypass: { mode } };
}

function parseReviewerConfig(value: unknown): RawGuardConfig["reviewer"] {
  const reviewer = requireRecord(value, "reviewer");
  const enabled = requireBoolean(reviewer.enabled, "reviewer.enabled");
  const timeoutMs = requirePositiveInteger(reviewer.timeoutMs, "reviewer.timeoutMs");
  const maxTranscriptChars = requirePositiveInteger(reviewer.maxTranscriptChars, "reviewer.maxTranscriptChars");
  return { enabled, timeoutMs, maxTranscriptChars };
}

function parseSandboxRuntimeConfig(value: unknown, field: string): SandboxRuntimeConfig {
  const sandbox = requireRecord(value, field);
  const network = requireRecord(sandbox.network, `${field}.network`);
  requireStringArray(network.allowedDomains, `${field}.network.allowedDomains`);
  requireStringArray(network.deniedDomains, `${field}.network.deniedDomains`);

  const filesystem = requireRecord(sandbox.filesystem, `${field}.filesystem`);
  requireStringArray(filesystem.denyRead, `${field}.filesystem.denyRead`);
  if (filesystem.allowRead !== undefined) requireStringArray(filesystem.allowRead, `${field}.filesystem.allowRead`);
  requireStringArray(filesystem.allowWrite, `${field}.filesystem.allowWrite`);
  requireStringArray(filesystem.denyWrite, `${field}.filesystem.denyWrite`);

  return sandbox as unknown as SandboxRuntimeConfig;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ConfigError(`${field} must be a boolean`);
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError(`${field} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new ConfigError(`${field} must be an array of non-empty strings`);
  }
  return value as string[];
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ConfigError(`${field} must be a positive integer`);
  }
  return value as number;
}
