import {
  createAgentSession,
  DefaultResourceLoader,
  type AgentSession,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionOptions,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { ReviewBackend, ReviewRequest } from "./service";
import { buildReviewPrompt } from "./prompt";
import { collectTranscriptEvidence } from "./evidence";
import { createReviewDecisionTool } from "./reviewer-tools";
import { parseReviewDecisionFromText, type ReviewDecision } from "./parse";
import { noopAuditSink } from "../audit";
import type { Services } from "../runtime-state";
import type { EffectiveConfig } from "../config/effective";
import { createBashTool } from "../tools/adapters/bash";
import { createReadTool } from "../tools/adapters/read";
import { createGrepTool } from "../tools/adapters/grep";
import { createFindTool } from "../tools/adapters/find";
import { createLsTool } from "../tools/adapters/ls";

export function buildReviewerServices(
  parentConfig: EffectiveConfig,
  parentSandbox: Services["sandbox"],
): Services {
  const sandboxRuntime = buildReviewerSandboxConfig(parentConfig.sandboxRuntime);
  const config: EffectiveConfig = {
    ...parentConfig,
    enforcement: {
      ...parentConfig.enforcement,
      bypass: { mode: "deny" },
    },
    sandboxRuntime,
  };
  return {
    config,
    sandbox: parentSandbox,
    audit: noopAuditSink,
  };
}

function resolveReviewerModel(
  modelConfig: string | undefined,
  ctx: ExtensionContext,
): typeof ctx.model {
  if (modelConfig) {
    const slashIndex = modelConfig.indexOf("/");
    if (slashIndex > 0) {
      const provider = modelConfig.slice(0, slashIndex);
      const modelId = modelConfig.slice(slashIndex + 1);
      const found = ctx.modelRegistry.find(provider, modelId);
      if (found) return found;
    }
  }
  return ctx.model;
}

export class PiChildSessionReviewBackend implements ReviewBackend {
  async review(request: ReviewRequest, ctx: ExtensionContext, signal?: AbortSignal): Promise<ReviewDecision> {
    throwIfAborted(signal);
    let recordedDecision: ReviewDecision | undefined;
    const services = buildReviewerServices(request.config, request.sandbox);
    const getServices = () => services;
    let session: AgentSession | undefined;

    const abortSession = () => {
      void session?.abort();
    };
    signal?.addEventListener("abort", abortSession, { once: true });

    try {
      const settingsManager = SettingsManager.inMemory({
        images: { blockImages: true },
      });
      const resourceLoader = new DefaultResourceLoader({
        cwd: request.cwd,
        agentDir: request.cwd,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: "You are a security reviewer. Use only provided evidence and reviewer tools.",
      });
      await resourceLoader.reload();

      throwIfAborted(signal);
      const model = resolveReviewerModel(request.config.reviewer?.model, ctx);

      const created = await createAgentSession({
        cwd: request.cwd,
        model,
        thinkingLevel: (request.config.reviewer?.thinkingLevel ?? "off") as CreateAgentSessionOptions["thinkingLevel"],
        noTools: "all",
        tools: ["bash", "read", "grep", "find", "ls", "review_decision"],
        customTools: withReviewAbortSignal(
          [
            createBashTool(getServices),
            createReadTool(getServices),
            createGrepTool(getServices),
            createFindTool(getServices),
            createLsTool(getServices),
            createReviewDecisionTool((decision) => {
              recordedDecision = decision;
            }),
          ],
          signal,
        ),
        sessionManager: SessionManager.inMemory(request.cwd),
        settingsManager,
        resourceLoader,
      });
      session = created.session;

      const prompt = buildReviewPrompt({
        command: request.command,
        cwd: request.cwd,
        config: request.config,
        transcript: collectTranscriptEvidence(ctx, request.config.reviewer?.maxTranscriptChars ?? 12_000),
      });

      await raceWithAbort(
        session.prompt(prompt, { expandPromptTemplates: false, source: "extension" }),
        signal,
        async () => {
          await session?.abort();
        },
      );

      if (recordedDecision) {
        return recordedDecision;
      }

      const lastAssistant = [...session.messages]
        .reverse()
        .find((message) => message.role === "assistant");
      const text = extractText(lastAssistant?.content);
      return parseReviewDecisionFromText(text);
    } finally {
      signal?.removeEventListener("abort", abortSession);
      session?.dispose();
    }
  }
}

export function buildReviewerSandboxConfig(parent: SandboxRuntimeConfig): SandboxRuntimeConfig {
  return {
    ...parent,
    filesystem: {
      ...parent.filesystem,
      allowWrite: [],
    },
  };
}

function withReviewAbortSignal(tools: ToolDefinition[], reviewSignal: AbortSignal | undefined): ToolDefinition[] {
  if (!reviewSignal) {
    return tools;
  }
  return tools.map((tool) => ({
    ...tool,
    execute(toolCallId, params, signal, onUpdate, ctx) {
      return tool.execute(toolCallId, params, mergeAbortSignals(signal, reviewSignal), onUpdate, ctx);
    },
  }));
}

function mergeAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (activeSignals.length === 0) {
    return undefined;
  }
  if (activeSignals.length === 1) {
    return activeSignals[0];
  }

  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    signal.addEventListener("abort", () => abort(signal), { once: true });
  }
  return controller.signal;
}

async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort: () => Promise<void>,
): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    await onAbort();
    throw abortError(signal);
  }

  let removeAbortListener: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    const abort = () => {
      promise.catch(() => {});
      void onAbort().finally(() => reject(abortError(signal)));
    };
    signal.addEventListener("abort", abort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", abort);
  });

  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    removeAbortListener?.();
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("reviewer aborted");
}

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const record = item as Record<string, unknown>;
        return record.type === "text" && typeof record.text === "string" ? record.text : "";
      })
      .join("\n");
  }
  return "";
}
