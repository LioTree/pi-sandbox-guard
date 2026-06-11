import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { formatSize, type BashToolDetails } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ReviewDeniedError } from "../../errors";
import type { Services } from "../../runtime-state";
import { OutputAccumulator, type OutputSnapshot } from "../../runtime/output-accumulator";
import { runNativeCommand, runSandboxedCommand, sandboxCommandFromEnv } from "../../runtime/command-runner";
import { decideForTool, getToolCwd, textResult } from "../tool-context";

const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute in the sandboxed environment by default" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds" })),
  bypassSandbox: Type.Optional(
    Type.Boolean({
      description:
        "Request out-of-sandbox execution according to the current bypass policy. The request may be denied or reviewed; do not use it to work around sandbox policy denials",
    }),
  ),
});

export function createBashTool(getServices: () => Services): ToolDefinition {
  return {
    name: "bash",
    label: "bash",
    description:
      "Execute a shell command. Commands run in the sandbox by default and see the sandboxed filesystem view. Sandboxed output may show denyWrite empty placeholder files/directories; treat them as sandbox artifacts, not cleanup targets. Set bypassSandbox: true only to request out-of-sandbox execution according to the current bypass policy; requests may be denied or reviewed. Do not use bypassSandbox to work around sandbox policy denials.",
    promptSnippet: "Run shell commands through pi-sandbox-guard",
    parameters: bashSchema,
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

      const output = new OutputAccumulator({
        maxLines: services.config.toolOutput.maxLines,
        maxBytes: services.config.toolOutput.maxBytes,
        fullOutputDir: services.config.toolOutput.fullOutputDir,
        tempFilePrefix: "pi-sandbox-guard-bash",
      });

      const emitUpdate = () => {
        if (!onUpdate) return;
        const snapshot = output.snapshot({ persistIfTruncated: true });
        onUpdate({
          content: [{ type: "text", text: snapshot.content }],
          details: bashDetails(snapshot),
        });
      };

      const onData = (data: Buffer) => {
        output.append(data);
        emitUpdate();
      };

      const finishOutput = async () => {
        output.finish();
        emitUpdate();
        const snapshot = output.snapshot({ persistIfTruncated: true });
        await output.closeTempFile();
        return snapshot;
      };

      let exitCode: number | null;
      try {
        const result =
          decision.kind === "review"
            ? await runReviewedNativeCommand(services, params.command, cwd, params.timeout, signal, onData, ctx)
            : await runSandboxedCommand(
                services.sandbox,
                params.command,
                {
                  cwd,
                  timeout: params.timeout,
                  signal,
                  onData,
                  sandboxConfig: services.config.sandboxRuntime,
                  maxCapturedOutputBytes: services.config.toolOutput.maxBytes,
                  // Avoid passing raw user commands through sandbox-runtime's
                  // nested shell quoting; it can rewrite app-level syntax such
                  // as ripgrep's -g '!pattern' into a literal \! glob. Pass
                  // the logical command through the environment rather than
                  // stdin so commands inside the script can still read stdin.
                  ...sandboxCommandFromEnv(params.command),
                },
                services.audit,
              );
        exitCode = result.exitCode;
      } catch (error) {
        const snapshot = await finishOutput();
        const { text } = formatBashOutput(snapshot, output, services, "");
        if (error instanceof Error && text) {
          throw new Error(`${text}\n\n${error.message}`);
        }
        throw error;
      }

      const snapshot = await finishOutput();
      const { text, details } = formatBashOutput(snapshot, output, services);
      if (exitCode !== 0 && exitCode !== null) {
        throw new Error(`${text}\n\nCommand exited with code ${exitCode}`);
      }
      return textResult(text, { ...details, exitCode });
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
  if (!services.reviewer) {
    throw new ReviewDeniedError("reviewer service is unavailable");
  }
  await services.reviewer.review({ command, cwd, config: services.config, sandbox: services.sandbox }, ctx);
  return runNativeCommand(command, {
    cwd,
    timeout,
    signal,
    onData,
    maxCapturedOutputBytes: services.config.toolOutput.maxBytes,
  });
}

function bashDetails(snapshot: OutputSnapshot): BashToolDetails | undefined {
  return snapshot.truncation.truncated
    ? { truncation: snapshot.truncation, fullOutputPath: snapshot.fullOutputPath }
    : undefined;
}

function formatBashOutput(
  snapshot: OutputSnapshot,
  output: OutputAccumulator,
  services: Services,
  emptyText = "(no output)",
): { text: string; details: BashToolDetails | undefined } {
  const truncation = snapshot.truncation;
  let text = snapshot.content || emptyText;
  const details = bashDetails(snapshot);
  if (!truncation.truncated) {
    return { text, details };
  }

  const startLine = truncation.totalLines - truncation.outputLines + 1;
  const endLine = truncation.totalLines;
  const fullOutput = snapshot.fullOutputPath ?? "(full output unavailable)";
  if (truncation.lastLinePartial) {
    const lastLineSize = formatSize(output.getLastLineBytes());
    text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${fullOutput}]`;
  } else if (truncation.truncatedBy === "lines") {
    text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${fullOutput}]`;
  } else {
    text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(services.config.toolOutput.maxBytes)} limit). Full output: ${fullOutput}]`;
  }
  return { text, details };
}
