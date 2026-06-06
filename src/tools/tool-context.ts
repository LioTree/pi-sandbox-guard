import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Services } from "../runtime-state";
import type { CapabilityRequest } from "../policy/capability";
import { capabilityToolName } from "../policy/capability";
import { decidePolicy, type PolicyDecision } from "../policy/decision";
import { PolicyDeniedError } from "../errors";

export async function decideForTool(
  services: Services,
  request: CapabilityRequest,
): Promise<PolicyDecision> {
  services.audit({
    type: "tool_request",
    tool: capabilityToolName(request),
    kind: request.kind,
    path: "path" in request ? request.path : undefined,
    cwd: "cwd" in request ? request.cwd : undefined,
    bypass: "bypass" in request ? request.bypass : undefined,
  });
  const decision = await decidePolicy(request, services.config);
  services.audit({
    type: "policy_decision",
    tool: capabilityToolName(request),
    decision: decision.kind,
    reason: decision.reason,
  });
  if (decision.kind === "deny") {
    throw new PolicyDeniedError(decision.reason);
  }
  return decision;
}

export function textResult(text: string, details?: unknown) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

export function getToolCwd(ctx: ExtensionContext, fallback: string): string {
  return ctx.cwd || fallback;
}
