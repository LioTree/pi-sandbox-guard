import { describe, expect, it } from "vitest";
import { ReviewDeniedError } from "../../../src/errors";
import { parseReviewDecision, parseReviewDecisionFromText } from "../../../src/review/parse";

describe("review decision parsing", () => {
  it("accepts a valid structured decision", () => {
    expect(parseReviewDecision({ outcome: "allow", riskLevel: "low", rationale: "safe enough" })).toEqual({
      outcome: "allow",
      riskLevel: "low",
      rationale: "safe enough",
    });
  });

  it("rejects invalid structured decisions", () => {
    expect(() => parseReviewDecision({ outcome: "approve", rationale: "bad outcome" })).toThrow(ReviewDeniedError);
    expect(() => parseReviewDecision({ outcome: "allow", riskLevel: "critical", rationale: "bad risk" })).toThrow(ReviewDeniedError);
    expect(() => parseReviewDecision({ outcome: "allow", rationale: "" })).toThrow(ReviewDeniedError);
  });

  it("extracts a JSON decision from assistant text", () => {
    expect(parseReviewDecisionFromText('Decision:\n{"outcome":"deny","rationale":"too risky"}')).toEqual({
      outcome: "deny",
      rationale: "too risky",
    });
  });

  it("fails closed when assistant text does not contain valid decision JSON", () => {
    expect(() => parseReviewDecisionFromText("allow it")).toThrow(ReviewDeniedError);
    expect(() => parseReviewDecisionFromText('{"outcome":"allow"}')).toThrow(ReviewDeniedError);
  });
});
