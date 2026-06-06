import { ReviewDeniedError } from "../errors";

export type ReviewDecision = {
  outcome: "allow" | "deny";
  riskLevel?: "low" | "medium" | "high";
  rationale: string;
};

export function parseReviewDecision(value: unknown): ReviewDecision {
  if (!value || typeof value !== "object") {
    throw new ReviewDeniedError("reviewer returned a non-object decision");
  }
  const record = value as Record<string, unknown>;
  if (record.outcome !== "allow" && record.outcome !== "deny") {
    throw new ReviewDeniedError('reviewer outcome must be "allow" or "deny"');
  }
  if (record.riskLevel !== undefined && record.riskLevel !== "low" && record.riskLevel !== "medium" && record.riskLevel !== "high") {
    throw new ReviewDeniedError('reviewer riskLevel must be "low", "medium", or "high"');
  }
  if (typeof record.rationale !== "string" || record.rationale.length === 0) {
    throw new ReviewDeniedError("reviewer rationale must be a non-empty string");
  }
  return {
    outcome: record.outcome,
    riskLevel: record.riskLevel,
    rationale: record.rationale,
  };
}

export function parseReviewDecisionFromText(text: string): ReviewDecision {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new ReviewDeniedError("reviewer did not return JSON");
  }
  return parseReviewDecision(JSON.parse(text.slice(start, end + 1)));
}
