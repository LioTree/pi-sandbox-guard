import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createFileAuditSink } from "./audit";
import { loadEffectiveConfig } from "./config/load";
import { ConfigError, SandboxExecError, type SandboxGuardError, errorMessage } from "./errors";
import { renderPolicyPrompt } from "./prompt/render-policy-prompt";
import { ReviewService } from "./review/service";
import { SandboxSession } from "./runtime/sandbox-session";
import { type PluginState, requireReady } from "./runtime-state";
import { createSandboxGuardTools } from "./tools/adapters/registry";

export default function sandboxGuardExtension(pi: ExtensionAPI): void {
  const fileAuditSink = createFileAuditSink("~/.pi/sandbox-guard-audit.log");
  let state: PluginState = { kind: "not_started" };

  pi.registerFlag("sandbox-guard-audit", {
    description: "Write audit events to ~/.pi/sandbox-guard-audit.log",
    type: "boolean",
    default: false,
  });

  const getAudit = () => ((pi.getFlag("sandbox-guard-audit") as boolean) ? fileAuditSink : undefined);
  const registeredTools = new Set<string>();

  pi.on("session_start", async (_event, ctx) => {
    const auditSink = getAudit();
    const result = await loadEffectiveConfig(ctx.cwd, auditSink);
    if (result.kind === "disabled") {
      state = { kind: "disabled", reason: result.reason };
      auditSink?.({ type: "session_disabled", reason: result.reason });
      ctx.ui.notify(`pi-sandbox-guard disabled: ${result.reason}`, "warning");
      return;
    }

    if (result.kind === "error") {
      const error = toSandboxGuardError(result.error);
      state = { kind: "failed", error };
      auditSink?.({ type: "session_failed", message: error.message });
      ctx.ui.notify(`pi-sandbox-guard failed: ${error.message}`, "error");
      return;
    }

    const sandbox = new SandboxSession();
    try {
      await sandbox.initialize(result.config.sandboxRuntime);
      const reviewer = new ReviewService(undefined, auditSink);
      state = {
        kind: "ready",
        services: {
          config: result.config,
          sandbox,
          reviewer,
          audit: auditSink ?? (() => {}),
        },
      };
      for (const tool of createSandboxGuardTools(() => requireReady(state), result.config.enforcement.tools)) {
        if (registeredTools.has(tool.name)) {
          continue;
        }
        pi.registerTool(tool);
        registeredTools.add(tool.name);
      }
      auditSink?.({ type: "session_ready", sourcePath: result.config.sourcePath });
      ctx.ui.setStatus("sandbox-guard", "sandbox guard: ready");
      ctx.ui.notify(`pi-sandbox-guard ready: ${result.config.sourcePath}`, "info");
    } catch (error) {
      const guardError = new SandboxExecError(`sandbox initialization failed: ${errorMessage(error)}`, error);
      state = { kind: "failed", error: guardError };
      auditSink?.({ type: "session_failed", message: guardError.message });
      ctx.ui.notify(`pi-sandbox-guard failed: ${guardError.message}`, "error");
    }
  });

  pi.on("session_shutdown", async () => {
    if (state.kind !== "ready") {
      return;
    }
    try {
      await state.services.sandbox.reset();
    } finally {
      state = { kind: "not_started" };
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (state.kind !== "ready") {
      return;
    }
    const append = renderPolicyPrompt(state.services.config);
    return { systemPrompt: `${event.systemPrompt}\n${append}` };
  });
}

function toSandboxGuardError(error: Error): SandboxGuardError {
  return error instanceof ConfigError ? error : new ConfigError(error.message, error);
}
