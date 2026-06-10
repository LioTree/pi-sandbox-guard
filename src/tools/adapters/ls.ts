import {
  createLsToolDefinition,
  formatSize,
  truncateHead,
  type LsToolDetails,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import path from "node:path";
import type { Services } from "../../runtime-state";
import { runSandboxedStreamingCommand, sandboxCommandFromEnv } from "../../runtime/command-runner";
import { commandExitNotice, shellCommandFromArgv } from "../shell";
import { decideForTool, getToolCwd, textResult } from "../tool-context";

const DEFAULT_LIMIT = 500;

export function createLsTool(getServices: () => Services): ToolDefinition<any, any, any> {
  const template = createLsToolDefinition("");
  return {
    ...template,
    name: "ls",
    description: `${template.description} Access is constrained by pi-sandbox-guard path policy.`,
    promptSnippet: "List directories through pi-sandbox-guard",
    async execute(
      _toolCallId: string,
      params: { path?: string; limit?: number },
      signal: AbortSignal | undefined,
      _onUpdate: any,
      ctx: any,
    ) {
      const services = getServices();
      const cwd = getToolCwd(ctx, services.config.cwd);
      const root = path.resolve(cwd, params.path ?? ".");
      await decideForTool(services, { kind: "read", tool: "ls", path: root });
      const result = await executeSandboxedLs(services, cwd, root, params, signal);
      return textResult(result.text, result.details);
    },
  } as unknown as ToolDefinition<any, any, any>;
}

type LsParams = {
  path?: string;
  limit?: number;
};

async function executeSandboxedLs(
  services: Services,
  cwd: string,
  root: string,
  params: LsParams,
  signal?: AbortSignal,
): Promise<{ text: string; details?: LsToolDetails }> {
  const limit = params.limit ?? DEFAULT_LIMIT;
  const maxBytes = services.config.toolOutput.maxBytes;
  const outputLines: string[] = [];
  let entryLimitReached = false;
  let buffered = "";

  const command = buildLsCommand(root);
  const result = await runSandboxedStreamingCommand(
    services.sandbox,
    command,
    {
      cwd,
      signal,
      maxCapturedOutputBytes: maxBytes,
      ...sandboxCommandFromEnv(command),
      onStdout(chunk, control) {
        buffered += chunk.toString("utf-8");
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          addLsOutputLine(outputLines, line);
          if (outputLines.length > limit) {
            entryLimitReached = true;
            control.stop();
            break;
          }
        }
      },
    },
    services.audit,
  );

  if (buffered !== "" && !entryLimitReached) {
    addLsOutputLine(outputLines, buffered);
    if (outputLines.length > limit) {
      entryLimitReached = true;
    }
  }

  if (result.exitCode !== 0 && outputLines.length === 0) {
    throw new Error(result.stderr.trim() || commandExitNotice("ls", result.exitCode));
  }
  if (outputLines.length === 0) {
    return { text: "(empty directory)" };
  }

  const visibleLines = entryLimitReached ? outputLines.slice(0, limit) : outputLines;
  const rawOutput = visibleLines.join("\n");
  const truncation = truncateHead(rawOutput, {
    maxLines: Number.MAX_SAFE_INTEGER,
    maxBytes,
  });
  const notices: string[] = [];
  const details: LsToolDetails = {};
  if (entryLimitReached) {
    notices.push(`${limit} entries limit reached. Use limit=${limit * 2} for more`);
    details.entryLimitReached = limit;
  }
  if (truncation.truncated) {
    notices.push(`${formatSize(truncation.maxBytes)} limit reached`);
    details.truncation = truncation;
  }
  if (result.exitCode !== 0) {
    notices.push(`${commandExitNotice("ls", result.exitCode)}; results may be incomplete`);
  }

  const text = notices.length > 0 ? `${truncation.content}\n\n[${notices.join(". ")}]` : truncation.content;
  return { text, details: Object.keys(details).length > 0 ? details : undefined };
}

function addLsOutputLine(outputLines: string[], rawLine: string): void {
  const line = rawLine.replace(/\r$/, "");
  if (!line || line === "." || line === "..") {
    return;
  }
  outputLines.push(line);
}

function buildLsCommand(root: string): string {
  return shellCommandFromArgv(["ls", "-1Ap", "--", root]);
}
