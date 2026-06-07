import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewService, type ReviewBackend } from "../../../src/review/service";
import { effectiveConfig, fakeExtensionContext } from "../../helpers";

describe("ReviewService", () => {
  it("denies when reviewer is not enabled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-review-"));
    const service = new ReviewService(backendReturning({ outcome: "allow", rationale: "ok" }));

    await expect(
      service.review({ command: "id", cwd: root, config: effectiveConfig(root) }, fakeExtensionContext(root)),
    ).rejects.toThrow(/reviewer is not enabled/);
  });

  it("returns allow decisions from the backend", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-review-"));
    const config = effectiveConfig(root, {
      enforcement: { tools: ["bash"], bypass: { mode: "review" } },
      reviewer: { enabled: true, timeoutMs: 1_000, maxTranscriptChars: 1_000 },
    });
    const service = new ReviewService(backendReturning({ outcome: "allow", rationale: "ok" }));

    await expect(service.review({ command: "id", cwd: root, config }, fakeExtensionContext(root))).resolves.toEqual({
      outcome: "allow",
      rationale: "ok",
    });
  });

  it("fails closed on backend deny", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-review-"));
    const config = effectiveConfig(root, {
      enforcement: { tools: ["bash"], bypass: { mode: "review" } },
      reviewer: { enabled: true, timeoutMs: 1_000, maxTranscriptChars: 1_000 },
    });
    const service = new ReviewService(backendReturning({ outcome: "deny", rationale: "too risky" }));

    await expect(service.review({ command: "id", cwd: root, config }, fakeExtensionContext(root))).rejects.toThrow(
      /reviewer denied bypass: too risky/,
    );
  });

  it("fails closed on backend errors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-review-"));
    const config = effectiveConfig(root, {
      enforcement: { tools: ["bash"], bypass: { mode: "review" } },
      reviewer: { enabled: true, timeoutMs: 1_000, maxTranscriptChars: 1_000 },
    });
    const service = new ReviewService({
      async review() {
        throw new Error("backend crashed");
      },
    });

    await expect(service.review({ command: "id", cwd: root, config }, fakeExtensionContext(root))).rejects.toThrow(
      /reviewer failed closed: backend crashed/,
    );
  });

  it("fails closed on timeout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-review-"));
    const config = effectiveConfig(root, {
      enforcement: { tools: ["bash"], bypass: { mode: "review" } },
      reviewer: { enabled: true, timeoutMs: 1, maxTranscriptChars: 1_000 },
    });
    const service = new ReviewService({
      async review() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { outcome: "allow", rationale: "late" };
      },
    });

    await expect(service.review({ command: "id", cwd: root, config }, fakeExtensionContext(root))).rejects.toThrow(
      /reviewer timed out after 1ms/,
    );
  });
});

function backendReturning(decision: Awaited<ReturnType<ReviewBackend["review"]>>): ReviewBackend {
  return {
    async review() {
      if (decision.outcome === "deny") {
        return decision;
      }
      return decision;
    },
  };
}
