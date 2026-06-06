import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compilePathPolicy, checkPathAccess } from "../../../src/policy/path-policy";

describe("path policy", () => {
  it("allows reads by default and denies denyRead paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-policy-"));
    const secret = path.join(root, "secret");
    await mkdir(secret);
    const policy = compilePathPolicy(
      {
        denyRead: [secret],
        allowWrite: [root],
        denyWrite: [],
      },
      root,
    );

    await expect(checkPathAccess(policy, path.join(root, "public.txt"), "read")).resolves.toMatchObject({
      allowed: true,
    });
    await expect(checkPathAccess(policy, path.join(secret, "key.txt"), "read")).resolves.toMatchObject({
      allowed: false,
    });
  });

  it("lets allowRead re-allow a child inside denyRead to match sandbox-runtime semantics", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-policy-"));
    const secret = path.join(root, "secret");
    const allowedChild = path.join(secret, "public");
    await mkdir(allowedChild, { recursive: true });
    const policy = compilePathPolicy(
      {
        denyRead: [secret],
        allowRead: [allowedChild],
        allowWrite: [root],
        denyWrite: [],
      },
      root,
    );

    await expect(checkPathAccess(policy, path.join(allowedChild, "note.txt"), "read")).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("requires allowWrite and gives denyWrite precedence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-policy-"));
    const writable = path.join(root, "writable");
    const denied = path.join(writable, "blocked");
    await mkdir(denied, { recursive: true });
    const policy = compilePathPolicy(
      {
        denyRead: [],
        allowWrite: [writable],
        denyWrite: [denied],
      },
      root,
    );

    await expect(checkPathAccess(policy, path.join(writable, "ok.txt"), "write")).resolves.toMatchObject({
      allowed: true,
    });
    await expect(checkPathAccess(policy, path.join(root, "outside.txt"), "write")).resolves.toMatchObject({
      allowed: false,
    });
    await expect(checkPathAccess(policy, path.join(denied, "no.txt"), "write")).resolves.toMatchObject({
      allowed: false,
    });
  });

  it("resolves symlinks before deciding read access", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-policy-"));
    const publicDir = path.join(root, "public");
    const secretDir = path.join(root, "secret");
    await mkdir(publicDir);
    await mkdir(secretDir);
    const secretFile = path.join(secretDir, "token.txt");
    await writeFile(secretFile, "secret", "utf-8");
    const link = path.join(publicDir, "token-link.txt");
    await symlink(secretFile, link);

    const policy = compilePathPolicy(
      {
        denyRead: [secretDir],
        allowWrite: [publicDir],
        denyWrite: [],
      },
      root,
    );

    await expect(readFile(link, "utf-8")).resolves.toBe("secret");
    await expect(checkPathAccess(policy, link, "read")).resolves.toMatchObject({
      allowed: false,
    });
  });
});
