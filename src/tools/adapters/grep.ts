import {
  createGrepToolDefinition,
  formatSize,
  truncateHead,
  truncateLine,
  type GrepToolDetails,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import path from "node:path";
import type { Services } from "../../runtime-state";
import { runSandboxedStreamingCommand, sandboxCommandFromEnv } from "../../runtime/command-runner";
import { commandExitNotice, shellCommandFromArgv } from "../shell";
import { decideForTool, getToolCwd, textResult } from "../tool-context";

export function createGrepTool(getServices: () => Services): ToolDefinition<any, any, any> {
  const template = createGrepToolDefinition("");
  return {
    ...template,
    name: "grep",
    description: `${template.description} Search traversal follows the same shared sandbox.filesystem read policy as read, ls, and find. denyRead removes readable/searchable content unless allowRead re-allows a matching path inside it.`,
    promptSnippet: "Search file contents through pi-sandbox-guard",
    async execute(
      _toolCallId: string,
      params: {
        pattern: string;
        path?: string;
        glob?: string;
        ignoreCase?: boolean;
        literal?: boolean;
        context?: number;
        limit?: number;
      },
      _signal: AbortSignal | undefined,
      _onUpdate: any,
      ctx: any,
    ) {
      const services = getServices();
      const cwd = getToolCwd(ctx, services.config.cwd);
      const root = path.resolve(cwd, params.path ?? ".");
      await decideForTool(services, { kind: "read", tool: "grep", path: root });
      const result = await executeSandboxedRg(services, cwd, root, params, _signal);
      return textResult(result.text, result.details);
    },
  } as unknown as ToolDefinition<any, any, any>;
}

type GrepParams = {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
};

type RgJsonEvent =
  | {
      type: "match" | "context";
      data: {
        path: { text?: string };
        lines: { text?: string };
        line_number?: number;
      };
    }
  | { type: string; data?: unknown };

async function executeSandboxedRg(
  services: Services,
  cwd: string,
  root: string,
  params: GrepParams,
  signal?: AbortSignal,
): Promise<{ text: string; details?: GrepToolDetails }> {
  const limit = params.limit ?? 100;
  const maxBytes = services.config.toolOutput.maxBytes;
  const maxLineChars = services.config.toolOutput.grepMaxLineChars;
  const outputLines: string[] = [];
  let matches = 0;
  let matchLimitReached = false;
  let linesTruncated = false;
  let buffered = "";

  const command = buildRgCommand(root, params);
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
          const event = parseRgJsonEvent(line);
          if (!isLineEvent(event)) {
            continue;
          }
          const rendered = renderRgEvent(event, root, cwd, maxLineChars);
          if (!rendered) {
            continue;
          }
          outputLines.push(rendered.text);
          if (rendered.wasTruncated) {
            linesTruncated = true;
          }
          if (event.type === "match") {
            matches++;
            if (matches >= limit) {
              matchLimitReached = true;
              control.stop();
              break;
            }
          }
        }
      },
    },
    services.audit,
  );

  if (buffered.trim()) {
    const event = parseRgJsonEvent(buffered);
    if (isLineEvent(event) && matches < limit) {
      const rendered = renderRgEvent(event, root, cwd, maxLineChars);
      if (rendered) {
        outputLines.push(rendered.text);
        if (rendered.wasTruncated) {
          linesTruncated = true;
        }
        if (event.type === "match") {
          matches++;
        }
      }
    }
  }

  if (result.exitCode !== 0 && result.exitCode !== 1 && matches === 0 && !matchLimitReached) {
    throw new Error(result.stderr.trim() || commandExitNotice("rg", result.exitCode));
  }
  if (matches === 0) {
    return { text: "No matches found" };
  }

  const truncation = truncateHead(outputLines.join("\n"), {
    maxLines: Number.MAX_SAFE_INTEGER,
    maxBytes,
  });
  const notices: string[] = [];
  const details: GrepToolDetails = {};
  if (matchLimitReached) {
    notices.push(`${limit} matches limit reached. Use limit=${limit * 2} for more, or refine pattern`);
    details.matchLimitReached = limit;
  }
  if (truncation.truncated) {
    notices.push(`${formatSize(truncation.maxBytes)} limit reached`);
    details.truncation = truncation;
  }
  if (linesTruncated) {
    notices.push(`Some lines truncated to ${maxLineChars} chars. Use read tool to see full lines`);
    details.linesTruncated = true;
  }
  if (result.exitCode !== 0 && result.exitCode !== 1 && !matchLimitReached) {
    notices.push(`${commandExitNotice("rg", result.exitCode)}; results may be incomplete`);
  }

  const text = notices.length > 0 ? `${truncation.content}\n\n[${notices.join(". ")}]` : truncation.content;
  return { text, details: Object.keys(details).length > 0 ? details : undefined };
}

function buildRgCommand(root: string, params: GrepParams): string {
  const args = [
    "rg",
    "--json",
    "--line-number",
    "--color=never",
    "--hidden",
    "--no-require-git",
    "--no-ignore-parent",
  ];
  if (params.ignoreCase) {
    args.push("--ignore-case");
  }
  if (params.literal) {
    args.push("--fixed-strings");
  }
  if (params.context !== undefined && params.context > 0) {
    args.push("--context", String(params.context));
  }
  if (params.glob) {
    args.push("--glob", params.glob);
  }
  args.push("--", params.pattern, root);
  return shellCommandFromArgv(args);
}

function parseRgJsonEvent(line: string): RgJsonEvent | undefined {
  if (!line.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(line) as RgJsonEvent;
  } catch {
    return undefined;
  }
}

function isLineEvent(event: RgJsonEvent | undefined): event is Extract<RgJsonEvent, { type: "match" | "context" }> {
  return event?.type === "match" || event?.type === "context";
}

function renderRgEvent(
  event: Extract<RgJsonEvent, { type: "match" | "context" }>,
  root: string,
  cwd: string,
  maxLineChars: number,
): { text: string; wasTruncated: boolean } | undefined {
  const rawPath = event.data.path.text;
  const rawLine = event.data.lines.text;
  const lineNumber = event.data.line_number;
  if (!rawPath || !rawLine || lineNumber === undefined) {
    return undefined;
  }

  const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
  const relative = path.relative(root, absolutePath) || path.basename(absolutePath);
  const line = rawLine.replace(/\n$/, "").replace(/\r/g, "");
  const { text, wasTruncated } = truncateLine(line, maxLineChars);
  const separator = event.type === "match" ? ":" : "-";
  return { text: `${relative}${separator}${lineNumber}${separator} ${text}`, wasTruncated };
}
