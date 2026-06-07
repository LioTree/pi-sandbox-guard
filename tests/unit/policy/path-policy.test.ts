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

  it("treats **/ globs as matching root-level and nested paths without leaking outside cwd", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-policy-"));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "psg-policy-outside-"));
    const policy = compilePathPolicy(
      {
        denyRead: ["**/.env"],
        allowWrite: [root],
        denyWrite: ["**/.git"],
      },
      root,
    );

    await expect(checkPathAccess(policy, path.join(root, ".env"), "read")).resolves.toMatchObject({
      allowed: false,
    });
    await expect(checkPathAccess(policy, path.join(root, "nested", ".env"), "read")).resolves.toMatchObject({
      allowed: false,
    });
    await expect(checkPathAccess(policy, path.join(outsideRoot, ".env"), "read")).resolves.toMatchObject({
      allowed: true,
    });
    await expect(checkPathAccess(policy, path.join(root, ".git"), "write")).resolves.toMatchObject({
      allowed: false,
    });
    await expect(checkPathAccess(policy, path.join(root, ".git", "hooks", "pre-commit"), "write")).resolves.toMatchObject({
      allowed: false,
    });
    await expect(checkPathAccess(policy, path.join(root, "nested", ".git", "hooks", "pre-commit"), "write")).resolves.toMatchObject({
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

  it("decides symlink reads by the resolved real path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-policy-"));
    const deniedDir = path.join(root, "denied");
    const allowedDir = path.join(root, "allowed");
    await mkdir(deniedDir);
    await mkdir(allowedDir);
    const allowedFile = path.join(allowedDir, "ok.txt");
    await writeFile(allowedFile, "ok", "utf-8");
    const link = path.join(deniedDir, "ok-link.txt");
    await symlink(allowedFile, link);

    const policy = compilePathPolicy(
      {
        denyRead: [deniedDir],
        allowWrite: [root],
        denyWrite: [],
      },
      root,
    );

    await expect(checkPathAccess(policy, link, "read")).resolves.toMatchObject({
      allowed: true,
      resolvedPath: allowedFile,
    });
  });

  it("resolves missing write targets through the nearest existing parent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-policy-"));
    const publicDir = path.join(root, "public");
    const secretDir = path.join(root, "secret");
    await mkdir(publicDir);
    await mkdir(secretDir);
    const link = path.join(publicDir, "secret-link");
    await symlink(secretDir, link);

    const policy = compilePathPolicy(
      {
        denyRead: [],
        allowWrite: [publicDir],
        denyWrite: [secretDir],
      },
      root,
    );

    await expect(checkPathAccess(policy, path.join(link, "new.txt"), "write")).resolves.toMatchObject({
      allowed: false,
      resolvedPath: path.join(secretDir, "new.txt"),
    });
  });
});
