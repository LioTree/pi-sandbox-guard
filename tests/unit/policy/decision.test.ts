import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileEffectiveConfig } from "../../../src/config/compile";
import { decidePolicy } from "../../../src/policy/decision";
import { effectiveConfig } from "../../helpers";

describe("policy decision", () => {
  it("denies all requests when the effective config is disabled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-decision-"));
    const config = effectiveConfig(root, { enabled: false });

    await expect(
      decidePolicy({ kind: "shell", tool: "bash", command: "id", cwd: root, bypass: false }, config),
    ).resolves.toMatchObject({ kind: "deny", reason: expect.stringContaining("disabled") });
  });

  it("denies tools not listed in enforcement.tools", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-decision-"));
    const config = effectiveConfig(root, {
      enforcement: { tools: ["read"], bypass: { mode: "deny" } },
    });

    await expect(
      decidePolicy({ kind: "shell", tool: "bash", command: "id", cwd: root, bypass: false }, config),
    ).resolves.toMatchObject({ kind: "deny", reason: expect.stringContaining("not enabled") });
  });

  it("allows and denies read requests through the path policy", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-decision-"));
    const denied = path.join(root, "secret.txt");
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [denied], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["read"], bypass: { mode: "deny" } },
    });

    await expect(decidePolicy({ kind: "read", tool: "read", path: path.join(root, "ok.txt") }, config)).resolves.toMatchObject({
      kind: "native",
    });
    await expect(decidePolicy({ kind: "read", tool: "read", path: denied }, config)).resolves.toMatchObject({
      kind: "deny",
    });
  });

  it("allows and denies write requests through the path policy", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-decision-"));
    const writable = path.join(root, "writable");
    const blocked = path.join(writable, "blocked.txt");
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [writable], denyWrite: [blocked] } },
      enforcement: { tools: ["write"], bypass: { mode: "deny" } },
    });

    await expect(decidePolicy({ kind: "write", tool: "write", path: path.join(writable, "ok.txt") }, config)).resolves.toMatchObject({
      kind: "native",
    });
    await expect(decidePolicy({ kind: "write", tool: "write", path: path.join(root, "outside.txt") }, config)).resolves.toMatchObject({
      kind: "deny",
    });
    await expect(decidePolicy({ kind: "write", tool: "write", path: blocked }, config)).resolves.toMatchObject({
      kind: "deny",
    });
  });

  it("routes normal shell commands to the sandbox", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-decision-"));
    const config = effectiveConfig(root, {
      enforcement: { tools: ["bash"], bypass: { mode: "deny" } },
    });

    await expect(
      decidePolicy({ kind: "shell", tool: "bash", command: "id", cwd: root, bypass: false }, config),
    ).resolves.toMatchObject({ kind: "sandboxed" });
  });

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
