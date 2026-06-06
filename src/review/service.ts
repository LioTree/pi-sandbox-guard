import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EffectiveConfig } from "../config/effective";
import type { AuditSink } from "../audit";
import { ReviewDeniedError, errorMessage } from "../errors";
import { PiChildSessionReviewBackend } from "./child-session";
import type { ReviewDecision } from "./parse";

export type ReviewRequest = {
  command: string;
  cwd: string;
  config: EffectiveConfig;
};

export interface ReviewBackend {
  review(request: ReviewRequest, ctx: ExtensionContext): Promise<ReviewDecision>;
}

export class ReviewService {
  constructor(
    private readonly backend: ReviewBackend = new PiChildSessionReviewBackend(),
    private readonly audit?: AuditSink,
  ) {}

  async review(request: ReviewRequest, ctx: ExtensionContext): Promise<ReviewDecision> {
    const reviewer = request.config.reviewer;
    if (!reviewer?.enabled) {
      throw new ReviewDeniedError("reviewer is not enabled");
    }

    this.audit?.({ type: "review_request", command: request.command, cwd: request.cwd });

    try {
      const decision = await withTimeout(
        this.backend.review(request, ctx),
        reviewer.timeoutMs,
        `reviewer timed out after ${reviewer.timeoutMs}ms`,
      );
      this.audit?.({ type: "review_outcome", outcome: decision.outcome, rationale: decision.rationale });
      if (decision.outcome !== "allow") {
        throw new ReviewDeniedError(`reviewer denied bypass: ${decision.rationale}`);
      }
      return decision;
    } catch (error) {
      if (error instanceof ReviewDeniedError) {
        throw error;
      }
      throw new ReviewDeniedError(`reviewer failed closed: ${errorMessage(error)}`, error);
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new ReviewDeniedError(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
