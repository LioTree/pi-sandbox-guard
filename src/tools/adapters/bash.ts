import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Services } from "../../runtime-state";
import { runNativeCommand, runSandboxedCommand } from "../../runtime/command-runner";
import { decideForTool, getToolCwd, textResult } from "../tool-context";

const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds" })),
  bypassSandbox: Type.Optional(Type.Boolean({ description: "Request automatic reviewer approval to run outside sandbox" })),
});

export function createBashTool(getServices: () => Services): ToolDefinition {
  return {
    name: "bash",
    label: "bash",
    description: "Execute a shell command. Commands run in sandbox by default. Set bypassSandbox: true only when an automatic security review is required.",
    promptSnippet: "Run shell commands through pi-sandbox-guard",
    parameters: bashSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params: { command: string; timeout?: number; bypassSandbox?: boolean }, signal, onUpdate, ctx: ExtensionContext) {
      const services = getServices();
      const cwd = getToolCwd(ctx, services.config.cwd);
      const decision = await decideForTool(services, {
        kind: "shell",
        tool: "bash",
        command: params.command,
        cwd,
        bypass: params.bypassSandbox === true,
      });

      const onData = (data: Buffer) => {
        onUpdate?.({ content: [{ type: "text", text: data.toString() }], details: undefined });
      };

      const result =
        decision.kind === "review"
          ? await runReviewedNativeCommand(services, params.command, cwd, params.timeout, signal, onData, ctx)
          : await runSandboxedCommand(
              services.sandbox,
              params.command,
              { cwd, timeout: params.timeout, signal, onData },
              services.audit,
            );

      const output = [result.stdout, result.stderr].filter(Boolean).join("");
      const suffix = result.exitCode === 0 ? "" : `\n[exit code: ${result.exitCode}]`;
      return textResult((output || "(no output)") + suffix, { exitCode: result.exitCode });
    },
  };
}

async function runReviewedNativeCommand(
  services: Services,
  command: string,
  cwd: string,
  timeout: number | undefined,
  signal: AbortSignal | undefined,
  onData: (data: Buffer) => void,
  ctx: ExtensionContext,
) {
  await services.reviewer?.review({ command, cwd, config: services.config }, ctx);
  return runNativeCommand(command, { cwd, timeout, signal, onData });
}
