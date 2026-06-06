import type { PolicyDecision } from "./decision";

export function explainDecision(decision: PolicyDecision): string {
  switch (decision.kind) {
    case "deny":
      return `Denied: ${decision.reason}`;
    case "native":
      return `Allowed natively: ${decision.reason}`;
    case "sandboxed":
      return `Allowed in sandbox: ${decision.reason}`;
    case "review":
      return `Requires reviewer: ${decision.reason}`;
  }
}
