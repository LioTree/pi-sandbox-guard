import type { FilesystemConfig } from "@anthropic-ai/sandbox-runtime";
import { access, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createGlobMatcher, matchesGlobOrAncestor, type GlobMatcher } from "./glob-match";

export type AccessMode = "read" | "write";

type PathRule = {
  raw: string;
  pattern: string;
  hasMagic: boolean;
  globMatcher?: GlobMatcher;
};

export type CompiledPathPolicy = {
  cwd: string;
  denyRead: PathRule[];
  allowRead: PathRule[];
  allowWrite: PathRule[];
  denyWrite: PathRule[];
};

export type PathAccessResult = { allowed: true; resolvedPath: string } | { allowed: false; resolvedPath: string; reason: string };

export function compilePathPolicy(filesystem: FilesystemConfig, cwd: string): CompiledPathPolicy {
  return {
    cwd: path.resolve(cwd),
    denyRead: compileRules(filesystem.denyRead, cwd),
    allowRead: compileRules(filesystem.allowRead ?? [], cwd),
    allowWrite: compileRules(filesystem.allowWrite, cwd),
    denyWrite: compileRules(filesystem.denyWrite, cwd),
  };
}

export async function checkPathAccess(
  policy: CompiledPathPolicy,
  requestedPath: string,
  mode: AccessMode,
): Promise<PathAccessResult> {
  const resolvedPath = await resolveForPolicy(requestedPath, policy.cwd, mode);

  if (mode === "read") {
    if (matchesAny(policy.denyRead, resolvedPath) && !matchesAny(policy.allowRead, resolvedPath)) {
      return {
        allowed: false,
        resolvedPath,
        reason: `read denied by sandbox.filesystem.denyRead: ${requestedPath}`,
      };
    }
    return { allowed: true, resolvedPath };
  }

  if (!matchesAny(policy.allowWrite, resolvedPath)) {
    return {
      allowed: false,
      resolvedPath,
      reason: `write not allowed by sandbox.filesystem.allowWrite: ${requestedPath}`,
    };
  }

  if (matchesAny(policy.denyWrite, resolvedPath)) {
    return {
      allowed: false,
      resolvedPath,
      reason: `write denied by sandbox.filesystem.denyWrite: ${requestedPath}`,
    };
  }

  return { allowed: true, resolvedPath };
}

export async function resolveForPolicy(requestedPath: string, cwd: string, mode: AccessMode): Promise<string> {
  const absolutePath = resolveConfigPath(requestedPath, cwd);

  if (mode === "read") {
    try {
      await access(absolutePath);
      return await realpath(absolutePath);
    } catch {
      return absolutePath;
    }
  }

  try {
    await access(absolutePath);
    return await realpath(absolutePath);
  } catch {
    return resolveNewPathViaNearestParent(absolutePath);
  }
}

export function resolveConfigPath(value: string, cwd: string): string {
  const expanded = value === "~" || value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value;
  return path.resolve(cwd, expanded);
}

function compileRules(values: string[], cwd: string): PathRule[] {
  return values.map((value) => {
    const pattern = resolveConfigPath(value, cwd);
    const hasMagic = hasGlobMagic(pattern);
    return {
      raw: value,
      pattern,
      hasMagic,
      globMatcher: hasMagic ? createGlobMatcher(pattern) : undefined,
    };
  });
}

async function resolveNewPathViaNearestParent(absolutePath: string): Promise<string> {
  const missingParts: string[] = [];
  let current = absolutePath;

  while (true) {
    try {
      const currentStat = await stat(current);
      const realParent = currentStat.isDirectory() ? await realpath(current) : await realpath(path.dirname(current));
      return path.join(realParent, ...missingParts.reverse());
    } catch {
      const parent = path.dirname(current);
      const base = path.basename(current);
      missingParts.push(base);
      if (parent === current) {
        return absolutePath;
      }
      current = parent;
    }
  }
}

function matchesAny(rules: PathRule[], targetPath: string): boolean {
  return rules.some((rule) => matchesRule(rule, targetPath));
}

function matchesRule(rule: PathRule, targetPath: string): boolean {
  const normalizedTarget = path.resolve(targetPath);
  if (rule.hasMagic) {
    return rule.globMatcher ? matchesGlobOrAncestor(normalizedTarget, rule.globMatcher) : false;
  }
  const normalizedPattern = path.resolve(rule.pattern);
  return normalizedTarget === normalizedPattern || normalizedTarget.startsWith(normalizedPattern + path.sep);
}

function hasGlobMagic(value: string): boolean {
  return /[*?\[\]{}]/.test(value);
}
