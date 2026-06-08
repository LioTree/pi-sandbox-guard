import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewService, type ReviewBackend } from "../../../src/review/service";
import { SandboxSession } from "../../../src/runtime/sandbox-session";
import { effectiveConfig, fakeExtensionContext, fakeSandboxManager } from "../../helpers";

describe("ReviewService", () => {
  it("denies when reviewer is not enabled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-review-"));
    const service = new ReviewService(backendReturning({ outcome: "allow", rationale: "ok" }));

    await expect(
      service.review(reviewRequest(root, effectiveConfig(root)), fakeExtensionContext(root)),
    ).rejects.toThrow(/reviewer is not enabled/);
  });

  it("returns allow decisions from the backend", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-review-"));
    const config = effectiveConfig(root, {
      enforcement: { tools: ["bash"], bypass: { mode: "review" } },
      reviewer: { enabled: true, timeoutMs: 1_000, maxTranscriptTokens: 1_000 },
    });
    const service = new ReviewService(backendReturning({ outcome: "allow", rationale: "ok" }));

    await expect(service.review(reviewRequest(root, config), fakeExtensionContext(root))).resolves.toEqual({
      outcome: "allow",
      rationale: "ok",
    });
  });

  it("fails closed on backend deny", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-review-"));
    const config = effectiveConfig(root, {
      enforcement: { tools: ["bash"], bypass: { mode: "review" } },
      reviewer: { enabled: true, timeoutMs: 1_000, maxTranscriptTokens: 1_000 },
    });
    const service = new ReviewService(backendReturning({ outcome: "deny", rationale: "too risky" }));

    await expect(service.review(reviewRequest(root, config), fakeExtensionContext(root))).rejects.toThrow(
      /reviewer denied bypass: too risky/,
    );
  });

  it("fails closed on backend errors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-review-"));
    const config = effectiveConfig(root, {
      enforcement: { tools: ["bash"], bypass: { mode: "review" } },
      reviewer: { enabled: true, timeoutMs: 1_000, maxTranscriptTokens: 1_000 },
    });
    const service = new ReviewService({
      async review() {
        throw new Error("backend crashed");
      },
    });

    await expect(service.review(reviewRequest(root, config), fakeExtensionContext(root))).rejects.toThrow(
      /reviewer failed closed: backend crashed/,
    );
  });

  it("fails closed on timeout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-review-"));
    const config = effectiveConfig(root, {
      enforcement: { tools: ["bash"], bypass: { mode: "review" } },
      reviewer: { enabled: true, timeoutMs: 1, maxTranscriptTokens: 1_000 },
    });
    const service = new ReviewService({
      async review() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { outcome: "allow", rationale: "late" };
      },
    });

    await expect(service.review(reviewRequest(root, config), fakeExtensionContext(root))).rejects.toThrow(
      /reviewer timed out after 1ms/,
    );
  });

  it("aborts the backend when reviewer timeout expires", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-review-"));
    const config = effectiveConfig(root, {
      enforcement: { tools: ["bash"], bypass: { mode: "review" } },
      reviewer: { enabled: true, timeoutMs: 1, maxTranscriptTokens: 1_000 },
    });
    let backendSignal: AbortSignal | undefined;
    const service = new ReviewService({
      async review(_request, _ctx, signal) {
        backendSignal = signal;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { outcome: "allow", rationale: "late" };
      },
    });

    await expect(service.review(reviewRequest(root, config), fakeExtensionContext(root))).rejects.toThrow(
      /reviewer timed out after 1ms/,
    );
    expect(backendSignal?.aborted).toBe(true);
  });
});

function reviewRequest(root: string, config: ReturnType<typeof effectiveConfig>) {
  return {
    command: "id",
    cwd: root,
    config,
    sandbox: new SandboxSession(fakeSandboxManager()),
  };
}

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
