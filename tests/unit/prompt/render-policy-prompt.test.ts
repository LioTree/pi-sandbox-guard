import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileEffectiveConfig } from "../../../src/config/compile";
import { renderPolicyPrompt } from "../../../src/prompt/render-policy-prompt";

describe("renderPolicyPrompt", () => {
  it("renders review-mode bypass guidance distinctly", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-prompt-"));
    const config = compileEffectiveConfig(
      {
        enabled: true,
        sandbox: {
          network: {
            allowedDomains: ["api.example.com", "cdn.example.com"],
            deniedDomains: ["blocked.example.com"],
          },
          filesystem: {
            denyRead: ["secrets", "**/.env"],
            allowRead: ["secrets/public"],
            allowWrite: ["workspace", "tmp/output.log"],
            denyWrite: ["workspace/.git", "workspace/protected"],
          },
        },
        enforcement: {
          tools: ["bash", "read", "write", "edit", "grep", "find", "ls"],
          bypass: { mode: "review" },
        },
        reviewer: { enabled: true, timeoutMs: 1_000, maxTranscriptTokens: 1_000 },
      },
      path.join(root, ".pi", "sandbox-guard.json"),
      root,
    );

    const prompt = renderPolicyPrompt(config);

    expect(prompt).toContain("# pi-sandbox-guard");
    expect(prompt).toContain(`Config source: ${config.sourcePath}`);
    expect(prompt).toContain(`Working directory for relative policy paths: ${config.cwd}`);
    expect(prompt).toContain("Relative paths resolve from the current working directory. ~ resolves to the user home directory.");
    expect(prompt).toContain("Read access is default-allow");
    expect(prompt).toContain("allowRead overrides denyRead");
    expect(prompt).toContain("Write access is default-deny");
    expect(prompt).toContain("writable only if it matches allowWrite and does not match denyWrite");
    expect(prompt).toContain('Configured denyRead:\n- "secrets"\n- "**/.env"');
    expect(prompt).toContain('Configured allowRead:\n- "secrets/public"');
    expect(prompt).toContain('Configured allowWrite:\n- "workspace"\n- "tmp/output.log"');
    expect(prompt).toContain('Configured denyWrite:\n- "workspace/.git"\n- "workspace/protected"');
    expect(prompt).toContain('Allowed domains:\n- "api.example.com"\n- "cdn.example.com"');
    expect(prompt).toContain('Denied domains:\n- "blocked.example.com"');
    expect(prompt).toContain("- review: bypassSandbox does not directly run on host");
    expect(prompt).toContain("requests reviewer approval for out-of-sandbox execution");
    expect(prompt).toContain("Request it only when the current sandbox policy blocks a capability required for the user's task and the unsandboxed action is narrowly scoped and low risk.");
    expect(prompt).toContain("Reviewer decisions fail closed on timeout, errors, invalid output, or rejection.");
    expect(prompt).toContain("Do not use bypassSandbox to work around sandbox.filesystem policy denials.");
    expect(prompt).toContain("denyWrite");
    expect(prompt).toContain("empty placeholder");
    expect(prompt.toLowerCase()).toContain("do not delete");
  });

  it("renders review-mode bypass guidance for unavailable reviewers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-prompt-"));
    const config = compileEffectiveConfig(
      {
        enabled: true,
        sandbox: {
          network: { allowedDomains: [], deniedDomains: [] },
          filesystem: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [] },
        },
        enforcement: {
          tools: ["bash"],
          bypass: { mode: "review" },
        },
        reviewer: { enabled: false, timeoutMs: 1_000, maxTranscriptTokens: 1_000 },
      },
      path.join(root, ".pi", "sandbox-guard.json"),
      root,
    );

    const prompt = renderPolicyPrompt(config);

    expect(prompt).toContain("- review: bypassSandbox does not directly run on host");
    expect(prompt).toContain("Request it only when the current sandbox policy blocks a capability required for the user's task and the unsandboxed action is narrowly scoped and low risk.");
    expect(prompt).toContain("Reviewer is unavailable or disabled, so bypass requests fail closed.");
  });

  it("renders deny-mode bypass guidance distinctly and none for empty configured arrays", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-prompt-"));
    const config = compileEffectiveConfig(
      {
        enabled: true,
        sandbox: {
          network: { allowedDomains: [], deniedDomains: [] },
          filesystem: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [] },
        },
        enforcement: {
          tools: ["bash"],
          bypass: { mode: "deny" },
        },
      },
      path.join(root, ".pi", "sandbox-guard.json"),
      root,
    );

    const prompt = renderPolicyPrompt(config);

    expect(prompt).toContain("Configured denyRead:\n- none");
    expect(prompt).toContain("Configured allowRead:\n- none");
    expect(prompt).toContain("Configured allowWrite:\n- none");
    expect(prompt).toContain("Configured denyWrite:\n- none");
    expect(prompt).toContain("Allowed domains:\n- none");
    expect(prompt).toContain("Denied domains:\n- none");
    expect(prompt).toContain("- deny: bypassSandbox is denied by configuration; do not set it.");
    expect(prompt).toContain("Use allowed paths, report the denial, or ask the user to change config.");
    expect(prompt).not.toContain("reviewer approval");
  });
});
