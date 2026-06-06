import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { parseReviewDecision, type ReviewDecision } from "./parse";

export function createReviewDecisionTool(
  recordDecision: (decision: ReviewDecision) => void,
): ToolDefinition {
  return {
    name: "review_decision",
    label: "review decision",
    description: "Submit the final sandbox bypass decision.",
    parameters: Type.Object({
      outcome: Type.Union([Type.Literal("allow"), Type.Literal("deny")]),
      riskLevel: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
      rationale: Type.String(),
    }),
    async execute(_id, params: unknown) {
      const decision = parseReviewDecision(params);
      recordDecision(decision);
      return {
        content: [{ type: "text", text: `Decision recorded: ${decision.outcome}` }],
        details: undefined,
        terminate: true,
      };
    },
  };
}
