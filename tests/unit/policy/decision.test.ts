import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileEffectiveConfig } from "../../../src/config/compile";
import { decidePolicy } from "../../../src/policy/decision";

describe("policy decision", () => {
  it("routes explicit shell bypass to review when configured", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-decision-"));
    const config = compileEffectiveConfig(
      {
        enabled: true,
        sandbox: {
          network: { allowedDomains: [], deniedDomains: [] },
          filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] },
        },
        enforcement: {
          tools: ["bash"],
          bypass: { mode: "review" },
        },
        reviewer: { enabled: true, timeoutMs: 1_000, maxTranscriptChars: 1_000 },
      },
      path.join(root, ".pi", "sandbox-guard.json"),
      root,
    );

    await expect(
      decidePolicy({ kind: "shell", tool: "bash", command: "id", cwd: root, bypass: true }, config),
    ).resolves.toMatchObject({ kind: "review" });
  });

  it("denies explicit shell bypass when review is not configured", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-decision-"));
    const config = compileEffectiveConfig(
      {
        enabled: true,
        sandbox: {
          network: { allowedDomains: [], deniedDomains: [] },
          filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] },
        },
        enforcement: {
          tools: ["bash"],
          bypass: { mode: "deny" },
        },
      },
      path.join(root, ".pi", "sandbox-guard.json"),
      root,
    );

    await expect(
      decidePolicy({ kind: "shell", tool: "bash", command: "id", cwd: root, bypass: true }, config),
    ).resolves.toMatchObject({ kind: "deny" });
  });
});
