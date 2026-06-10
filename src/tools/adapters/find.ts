import {
  createFindToolDefinition,
  formatSize,
  truncateHead,
  type FindToolDetails,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import path from "node:path";
import type { Services } from "../../runtime-state";
import { runSandboxedStreamingCommand, sandboxCommandFromEnv } from "../../runtime/command-runner";
import { commandExitNotice, shellQuote } from "../shell";
import { decideForTool, getToolCwd, textResult } from "../tool-context";

const DEFAULT_LIMIT = 1000;

export function createFindTool(getServices: () => Services): ToolDefinition<any, any, any> {
  const template = createFindToolDefinition("");
  return {
    ...template,
    name: "find",
    description: `${template.description} Access is constrained by pi-sandbox-guard path policy.`,
    promptSnippet: "Find files through pi-sandbox-guard",
    async execute(
      _toolCallId: string,
      params: { pattern: string; path?: string; limit?: number },
      signal: AbortSignal | undefined,
      _onUpdate: any,
      ctx: any,
    ) {
      const services = getServices();
      const cwd = getToolCwd(ctx, services.config.cwd);
      const root = path.resolve(cwd, params.path ?? ".");
      await decideForTool(services, { kind: "read", tool: "find", path: root });
      const result = await executeSandboxedFd(services, cwd, root, params, signal);
      return textResult(result.text, result.details);
    },
  } as unknown as ToolDefinition<any, any, any>;
}

type FindParams = {
  pattern: string;
  path?: string;
  limit?: number;
};

async function executeSandboxedFd(
  services: Services,
  cwd: string,
  root: string,
  params: FindParams,
  signal?: AbortSignal,
): Promise<{ text: string; details?: FindToolDetails }> {
  const limit = params.limit ?? DEFAULT_LIMIT;
  const maxBytes = services.config.toolOutput.maxBytes;
  const outputLines: string[] = [];
  const commandLimit = limit + 1;
  let resultLimitReached = false;
  let buffered = "";

  const command = buildFdCommand(root, params.pattern, commandLimit);
  const result = await runSandboxedStreamingCommand(
    services.sandbox,
    command,
    {
      cwd,
      signal,
      maxCapturedOutputBytes: maxBytes,
      ...sandboxCommandFromEnv(command),
      onStdout(chunk) {
        buffered += chunk.toString("utf-8");
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          addFdOutputLine(outputLines, line, root, cwd);
          if (outputLines.length > limit) {
            resultLimitReached = true;
          }
        }
      },
    },
    services.audit,
  );

  if (buffered !== "") {
    addFdOutputLine(outputLines, buffered, root, cwd);
    if (outputLines.length > limit) {
      resultLimitReached = true;
    }
  }

  if (result.exitCode !== 0 && outputLines.length === 0) {
    throw new Error(result.stderr.trim() || commandExitNotice("fd", result.exitCode));
  }
  if (outputLines.length === 0) {
    return { text: "No files found matching pattern" };
  }

  const visibleLines = resultLimitReached ? outputLines.slice(0, limit) : outputLines;
  const rawOutput = visibleLines.join("\n");
  const truncation = truncateHead(rawOutput, {
    maxLines: Number.MAX_SAFE_INTEGER,
    maxBytes,
  });
  const notices: string[] = [];
  const details: FindToolDetails = {};
  if (resultLimitReached) {
    notices.push(`${limit} results limit reached. Use limit=${limit * 2} for more, or refine pattern`);
    details.resultLimitReached = limit;
  }
  if (truncation.truncated) {
    notices.push(`${formatSize(truncation.maxBytes)} limit reached`);
    details.truncation = truncation;
  }
  if (result.exitCode !== 0) {
    notices.push(`${commandExitNotice("fd", result.exitCode)}; results may be incomplete`);
  }

  const text = notices.length > 0 ? `${truncation.content}\n\n[${notices.join(". ")}]` : truncation.content;
  return { text, details: Object.keys(details).length > 0 ? details : undefined };
}

function addFdOutputLine(outputLines: string[], rawLine: string, root: string, cwd: string): void {
  const line = rawLine.replace(/\r$/, "");
  if (!line) {
    return;
  }
  const hadTrailingSlash = line.endsWith("/") || line.endsWith("\\");
  const absolutePath = path.isAbsolute(line) ? line : path.resolve(cwd, line);
  let relativePath = path.relative(root, absolutePath) || path.basename(absolutePath);
  if (hadTrailingSlash && !relativePath.endsWith(path.sep)) {
    relativePath += path.sep;
  }
  outputLines.push(toPosixPath(relativePath));
}

function buildFdCommand(root: string, pattern: string, limit: number): string {
  const args = [
    "fd",
    "--glob",
    "--color=never",
    "--hidden",
    "--no-require-git",
    "--no-ignore-parent",
    "--max-results",
    String(limit),
  ];
  let effectivePattern = normalizeFdPattern(pattern);
  if (effectivePattern.includes("/")) {
    args.push("--full-path");
    if (!effectivePattern.startsWith("/") && !effectivePattern.startsWith("**/") && effectivePattern !== "**") {
      effectivePattern = `**/${effectivePattern}`;
    }
  }
  args.push(effectivePattern, root);
  return args.map(shellQuote).join(" ");
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function normalizeFdPattern(pattern: string): string {
  return pattern.startsWith("./") ? pattern.slice(2) : pattern;
}
