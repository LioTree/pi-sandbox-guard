import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReviewerServices } from "../../../src/review/child-session";
import { SandboxSession } from "../../../src/runtime/sandbox-session";
import { effectiveConfig, fakeSandboxManager } from "../../helpers";

describe("review child session services", () => {
  it("reuse the parent sandbox with a readonly command sandbox config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-review-child-"));
    const parentSandbox = new SandboxSession(fakeSandboxManager());
    const config = effectiveConfig(root, {
      enforcement: { tools: ["bash", "read", "grep", "find", "ls"], bypass: { mode: "review" } },
      reviewer: { enabled: true, timeoutMs: 1_000, maxTranscriptChars: 1_000 },
    });

    const services = buildReviewerServices(config, parentSandbox);

    expect(services.sandbox).toBe(parentSandbox);
    expect(services.config.enforcement.bypass.mode).toBe("deny");
    expect(services.config.sandboxRuntime.filesystem.allowWrite).toEqual([]);
    expect(config.sandboxRuntime.filesystem.allowWrite).toEqual([root]);
  });
});
