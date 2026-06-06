import type { EffectiveConfig } from "../config/effective";
import { PolicyDeniedError } from "../errors";
import { capabilityToolName, type CapabilityRequest } from "./capability";
import { checkPathAccess } from "./path-policy";

export type PolicyDecision =
  | { kind: "deny"; reason: string }
  | { kind: "native"; reason: string }
  | { kind: "sandboxed"; reason: string }
  | { kind: "review"; reason: string };

export async function decidePolicy(
  request: CapabilityRequest,
  effectiveConfig: EffectiveConfig,
): Promise<PolicyDecision> {
  if (!effectiveConfig.enabled) {
    return { kind: "deny", reason: "sandbox guard is disabled" };
  }

  const tool = capabilityToolName(request);
  if (!effectiveConfig.enforcement.tools.includes(tool)) {
    return { kind: "deny", reason: `${tool} is not enabled by enforcement.tools` };
  }

  if (request.kind === "read") {
    const access = await checkPathAccess(effectiveConfig.pathPolicy, request.path, "read");
    return access.allowed
      ? { kind: "native", reason: "path is readable by policy" }
      : { kind: "deny", reason: access.reason };
  }

  if (request.kind === "write") {
    const access = await checkPathAccess(effectiveConfig.pathPolicy, request.path, "write");
    return access.allowed
      ? { kind: "native", reason: "path is writable by policy" }
      : { kind: "deny", reason: access.reason };
  }

  if (request.bypass) {
    if (effectiveConfig.enforcement.bypass.mode === "review") {
      return { kind: "review", reason: "explicit bypass requires reviewer approval" };
    }
    return { kind: "deny", reason: "explicit bypass is denied by config" };
  }

  return { kind: "sandboxed", reason: "bash runs in sandbox by default" };
}

export function assertAllowedDecision(decision: PolicyDecision): void {
  if (decision.kind === "deny") {
    throw new PolicyDeniedError(decision.reason);
  }
}
