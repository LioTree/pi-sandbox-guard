import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionOptions,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { ReviewBackend, ReviewRequest } from "./service";
import { buildReviewPrompt } from "./prompt";
import { collectTranscriptEvidence } from "./evidence";
import { createReviewDecisionTool } from "./reviewer-tools";
import { parseReviewDecisionFromText, type ReviewDecision } from "./parse";
import { SandboxSession } from "../runtime/sandbox-session";
import { noopAuditSink } from "../audit";
import type { Services } from "../runtime-state";
import type { EffectiveConfig } from "../config/effective";
import { createBashTool } from "../tools/adapters/bash";
import { createReadTool } from "../tools/adapters/read";
import { createGrepTool } from "../tools/adapters/grep";
import { createFindTool } from "../tools/adapters/find";
import { createLsTool } from "../tools/adapters/ls";

function buildReviewerServices(
  parentConfig: EffectiveConfig,
  parentSandbox: SandboxRuntimeConfig,
  reviewerSandbox: SandboxSession,
): Services {
  const config: EffectiveConfig = {
    ...parentConfig,
    enforcement: {
      ...parentConfig.enforcement,
      bypass: { mode: "deny" },
    },
    sandboxRuntime: {
      ...parentSandbox,
      filesystem: {
        ...parentSandbox.filesystem,
        allowWrite: [],
      },
    },
  };
  return {
    config,
    sandbox: reviewerSandbox,
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
  async review(request: ReviewRequest, ctx: ExtensionContext): Promise<ReviewDecision> {
    let recordedDecision: ReviewDecision | undefined;
    const reviewerSandbox = new SandboxSession();
    await reviewerSandbox.initialize(buildReviewerSandboxConfig(request.config.sandboxRuntime));

    const services = buildReviewerServices(request.config, request.config.sandboxRuntime, reviewerSandbox);
    const getServices = () => services;

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

      const model = resolveReviewerModel(request.config.reviewer?.model, ctx);

      const { session } = await createAgentSession({
        cwd: request.cwd,
        model,
        thinkingLevel: (request.config.reviewer?.thinkingLevel ?? "off") as CreateAgentSessionOptions["thinkingLevel"],
        noTools: "all",
        tools: ["bash", "read", "grep", "find", "ls", "review_decision"],
        customTools: [
          createBashTool(getServices),
          createReadTool(getServices),
          createGrepTool(getServices),
          createFindTool(getServices),
          createLsTool(getServices),
          createReviewDecisionTool((decision) => {
            recordedDecision = decision;
          }),
        ],
        sessionManager: SessionManager.inMemory(request.cwd),
        settingsManager,
        resourceLoader,
      });

      const prompt = buildReviewPrompt({
        command: request.command,
        cwd: request.cwd,
        config: request.config,
        transcript: collectTranscriptEvidence(ctx, request.config.reviewer?.maxTranscriptChars ?? 12_000),
      });

      await session.prompt(prompt, { expandPromptTemplates: false, source: "extension" });

      if (recordedDecision) {
        return recordedDecision;
      }

      const lastAssistant = [...session.messages]
        .reverse()
        .find((message) => message.role === "assistant");
      const text = extractText(lastAssistant?.content);
      return parseReviewDecisionFromText(text);
    } finally {
      await reviewerSandbox.reset();
    }
  }
}

function buildReviewerSandboxConfig(parent: SandboxRuntimeConfig): SandboxRuntimeConfig {
  return {
    ...parent,
    filesystem: {
      ...parent.filesystem,
      allowWrite: [],
    },
  };
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
