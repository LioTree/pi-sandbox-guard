import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EffectiveConfig } from "../config/effective";
import type { AuditSink } from "../audit";
import { ReviewDeniedError, errorMessage } from "../errors";
import type { SandboxSession } from "../runtime/sandbox-session";
import { PiChildSessionReviewBackend } from "./child-session";
import type { ReviewDecision } from "./parse";

export type ReviewRequest = {
  command: string;
  cwd: string;
  config: EffectiveConfig;
  sandbox: SandboxSession;
};

export interface ReviewBackend {
  review(request: ReviewRequest, ctx: ExtensionContext, signal?: AbortSignal): Promise<ReviewDecision>;
}

export class ReviewService {
  constructor(
    private readonly backend: ReviewBackend = new PiChildSessionReviewBackend(),
    private readonly audit?: AuditSink,
  ) {}

  async review(request: ReviewRequest, ctx: ExtensionContext, signal?: AbortSignal): Promise<ReviewDecision> {
    const reviewer = request.config.reviewer;
    if (!reviewer?.enabled) {
      throw new ReviewDeniedError("reviewer is not enabled");
    }

    this.audit?.({ type: "review_request", command: request.command, cwd: request.cwd });
    setStatus(ctx, `reviewing bypass: ${truncateForStatus(request.command)}`);

    try {
      const decision = await withTimeout(
        (timeoutSignal) => this.backend.review(request, ctx, mergeAbortSignals(signal, timeoutSignal)),
        reviewer.timeoutMs,
        `reviewer timed out after ${reviewer.timeoutMs}ms`,
      );
      this.audit?.({ type: "review_outcome", outcome: decision.outcome, rationale: decision.rationale });
      if (decision.outcome !== "allow") {
        notify(ctx, `Bypass denied: ${decision.rationale}`, "error");
        setStatus(ctx, "bypass denied");
        throw new ReviewDeniedError(`reviewer denied bypass: ${decision.rationale}`);
      }
      notify(ctx, `Bypass approved: ${decision.rationale}`, "warning");
      setStatus(ctx, "bypass approved");
      return decision;
    } catch (error) {
      if (error instanceof ReviewDeniedError) {
        setStatus(ctx, "bypass denied");
        throw error;
      }
      notify(ctx, "Reviewer failed closed, bypass denied", "error");
      setStatus(ctx, "reviewer failed");
      throw new ReviewDeniedError(`reviewer failed closed: ${errorMessage(error)}`, error);
    }
  }
}

function setStatus(ctx: ExtensionContext, text: string): void {
  ctx.ui.setStatus?.("sandbox-guard", text);
}

function notify(ctx: ExtensionContext, text: string, level: "info" | "warning" | "error"): void {
  ctx.ui.notify?.(text, level);
}

function truncateForStatus(text: string, maxLen = 60): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

async function withTimeout<T>(factory: (signal: AbortSignal) => Promise<T>, timeoutMs: number, message: string): Promise<T> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new ReviewDeniedError(message);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    const promise = factory(controller.signal);
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
