import type { EffectiveConfig } from "./config/effective";
import type { SandboxGuardError } from "./errors";
import type { AuditSink } from "./audit";
import type { ReviewService } from "./review/service";
import type { SandboxSession } from "./runtime/sandbox-session";

export type Services = {
  config: EffectiveConfig;
  sandbox: SandboxSession;
  reviewer?: ReviewService;
  audit: AuditSink;
};

export type PluginState =
  | { kind: "not_started" }
  | { kind: "disabled"; reason: string }
  | { kind: "ready"; services: Services }
  | { kind: "failed"; error: SandboxGuardError };

export function requireReady(state: PluginState): Services {
  if (state.kind === "ready") {
    return state.services;
  }
  if (state.kind === "disabled") {
    throw new Error(`pi-sandbox-guard is disabled: ${state.reason}`);
  }
  if (state.kind === "failed") {
    throw state.error;
  }
  throw new Error("pi-sandbox-guard has not started");
}
