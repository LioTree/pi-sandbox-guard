import type { Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { formatSize, truncateHead, truncateLine, type GrepToolDetails } from "@earendil-works/pi-coding-agent";
import type { CompiledPathPolicy } from "../policy/path-policy";
import { checkPathAccess, filterReadableChildren } from "../policy/path-policy";
import { createGlobMatcher } from "../policy/glob-match";
import { PolicyDeniedError } from "../errors";

type IgnoreRule = {
  baseDir: string;
  pattern: string;
  directoryOnly: boolean;
  hasSlash: boolean;
  negated: boolean;
  matcher: (candidate: string) => boolean;
};

export async function walkReadableFiles(
  pathPolicy: CompiledPathPolicy,
  root: string,
  limit: number,
): Promise<string[]> {
  const files: string[] = [];
  const visit = async (current: string, rules: IgnoreRule[]): Promise<void> => {
    if (files.length >= limit) return;
    const access = await checkPathAccess(pathPolicy, current, "read");
    if (!access.allowed) {
      return;
    }
    const currentStat = await stat(access.resolvedPath);
    if (!currentStat.isDirectory()) {
      files.push(access.resolvedPath);
      return;
    }
    const nextRules = [...rules, ...(await readIgnoreRules(pathPolicy, access.resolvedPath))];
    const entries = await filterReadableChildren(pathPolicy, access.resolvedPath, await readdir(access.resolvedPath));
    for (const entry of entries.sort()) {
      if (entry === ".git" || entry === "node_modules") continue;
      const childPath = path.join(access.resolvedPath, entry);
      let childStat: Stats;
      try {
        childStat = await stat(childPath);
      } catch {
        continue;
      }
      if (isIgnored(childPath, childStat.isDirectory(), nextRules)) continue;
      await visit(childPath, nextRules);
      if (files.length >= limit) return;
    }
  };
  try {
    await visit(root, []);
  } catch (error) {
    if (error instanceof PolicyDeniedError) return files;
    throw error;
  }
  return files;
}

export async function walkReadablePaths(
  pathPolicy: CompiledPathPolicy,
  root: string,
  limit: number,
): Promise<string[]> {
  const results: string[] = [];
  const visit = async (current: string, includeCurrent: boolean, rules: IgnoreRule[]): Promise<void> => {
    if (results.length >= limit) return;
    const access = await checkPathAccess(pathPolicy, current, "read");
    if (!access.allowed) {
      return;
    }
    const currentStat = await stat(access.resolvedPath);
    if (includeCurrent) {
      results.push(access.resolvedPath);
      if (results.length >= limit) return;
    }
    if (!currentStat.isDirectory()) {
      return;
    }
    const nextRules = [...rules, ...(await readIgnoreRules(pathPolicy, access.resolvedPath))];
    const entries = await filterReadableChildren(pathPolicy, access.resolvedPath, await readdir(access.resolvedPath));
    for (const entry of entries.sort()) {
      if (entry === ".git" || entry === "node_modules") continue;
      const childPath = path.join(access.resolvedPath, entry);
      let childStat: Stats;
      try {
        childStat = await stat(childPath);
      } catch {
        continue;
      }
      if (isIgnored(childPath, childStat.isDirectory(), nextRules)) continue;
      await visit(childPath, true, nextRules);
      if (results.length >= limit) return;
    }
  };
  try {
    await visit(root, false, []);
  } catch (error) {
    if (error instanceof PolicyDeniedError) return results;
    throw error;
  }
  return results;
}

export function createRegexMatcher(pattern: string, ignoreCase?: boolean): (line: string) => boolean {
  const regex = new RegExp(pattern, ignoreCase ? "i" : undefined);
  return (line) => regex.test(line);
}

export function normalizeCase(value: string, ignoreCase?: boolean): string {
  return ignoreCase ? value.toLowerCase() : value;
}

export function globMatcher(pattern: string): (file: string) => boolean {
  return createGlobMatcher(pattern);
}

export function filePatternMatcher(pattern: string): (file: string) => boolean {
  const matcher = globMatcher(pattern);
  if (pattern.includes("/") || pattern.includes(path.sep)) {
    return matcher;
  }
  return (file) => matcher(path.basename(file));
}

export async function executeRead(
  pathPolicy: CompiledPathPolicy,
  cwd: string,
  filePath: string,
  offset?: number,
  limit?: number,
): Promise<string> {
  const absolutePath = path.resolve(cwd, filePath);
  const content = await readFile(absolutePath, "utf-8");
  return sliceLines(content, offset, limit);
}

export async function executeGrep(
  pathPolicy: CompiledPathPolicy,
  cwd: string,
  pattern: string,
  opts: {
    searchPath?: string;
    glob?: string;
    ignoreCase?: boolean;
    literal?: boolean;
    context?: number;
    limit?: number;
    maxBytes?: number;
    maxLineChars?: number;
  } = {},
): Promise<{ text: string; details?: GrepToolDetails }> {
  const root = path.resolve(cwd, opts.searchPath ?? ".");
  const files = await walkReadableFiles(pathPolicy, root, 2_000);
  const matcher = opts.literal
    ? (line: string) => normalizeCase(line, opts.ignoreCase).includes(normalizeCase(pattern, opts.ignoreCase))
    : createRegexMatcher(pattern, opts.ignoreCase);
  const glob = opts.glob ? filePatternMatcher(opts.glob) : undefined;
  const limit = opts.limit ?? 100;
  const context = opts.context && opts.context > 0 ? opts.context : 0;
  const outputLines: string[] = [];
  let matches = 0;
  let matchLimitReached = false;
  let linesTruncated = false;
  for (const file of files) {
    const relative = path.relative(root, file) || path.basename(file);
    if (glob && !glob(relative)) continue;
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (matcher(lines[i]!)) {
        matches++;
        const start = context > 0 ? Math.max(0, i - context) : i;
        const end = context > 0 ? Math.min(lines.length - 1, i + context) : i;
        for (let current = start; current <= end; current++) {
          const line = lines[current] ?? "";
          const { text, wasTruncated } = truncateLine(line.replace(/\r/g, ""), opts.maxLineChars);
          if (wasTruncated) linesTruncated = true;
          if (current === i) {
            outputLines.push(`${relative}:${current + 1}: ${text}`);
          } else {
            outputLines.push(`${relative}-${current + 1}- ${text}`);
          }
        }
        if (matches >= limit) {
          matchLimitReached = true;
          break;
        }
      }
    }
    if (matchLimitReached) break;
  }
  if (matches === 0) {
    return { text: "No matches found" };
  }

  const truncation = truncateHead(outputLines.join("\n"), {
    maxLines: Number.MAX_SAFE_INTEGER,
    maxBytes: opts.maxBytes,
  });
  const notices: string[] = [];
  const details: GrepToolDetails = {};
  if (matchLimitReached) {
    notices.push(`${limit} matches limit reached. Use limit=${limit * 2} for more, or refine pattern`);
    details.matchLimitReached = limit;
  }
  if (truncation.truncated) {
    notices.push(`${formatSize(truncation.maxBytes)} limit reached`);
    details.truncation = truncation;
  }
  if (linesTruncated) {
    notices.push(`Some lines truncated to ${opts.maxLineChars ?? 500} chars. Use read tool to see full lines`);
    details.linesTruncated = true;
  }

  const text = notices.length > 0 ? `${truncation.content}\n\n[${notices.join(". ")}]` : truncation.content;
  return { text, details: Object.keys(details).length > 0 ? details : undefined };
}

export async function executeFind(
  pathPolicy: CompiledPathPolicy,
  cwd: string,
  pattern: string,
  opts: { searchPath?: string; limit?: number } = {},
): Promise<string> {
  const root = path.resolve(cwd, opts.searchPath ?? ".");
  const matcher = filePatternMatcher(pattern);
  const limit = opts.limit ?? 1_000;
  const files = await walkReadableFiles(pathPolicy, root, limit * 2);
  const results = files
    .map((file) => path.relative(root, file))
    .filter((file) => matcher(file))
    .slice(0, limit);
  return results.join("\n") || "No files found matching pattern";
}

export async function executeLs(
  pathPolicy: CompiledPathPolicy,
  cwd: string,
  opts: { searchPath?: string; limit?: number } = {},
): Promise<string> {
  const root = path.resolve(cwd, opts.searchPath ?? ".");
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }
  const entries = await filterReadableChildren(pathPolicy, root, await readdir(root));
  const limited = entries.sort().slice(0, opts.limit ?? 500);
  return limited.join("\n") || "(empty directory)";
}

function sliceLines(content: string, offset?: number, limit?: number): string {
  const lines = content.split("\n");
  const start = Math.max(0, (offset ?? 1) - 1);
  const end = limit === undefined ? undefined : start + Math.max(0, limit);
  return lines.slice(start, end).join("\n");
}

async function readIgnoreRules(pathPolicy: CompiledPathPolicy, dirPath: string): Promise<IgnoreRule[]> {
  const ignorePath = path.join(dirPath, ".gitignore");
  const access = await checkPathAccess(pathPolicy, ignorePath, "read");
  if (!access.allowed) return [];

  let content: string;
  try {
    content = await readFile(access.resolvedPath, "utf-8");
  } catch {
    return [];
  }

  return content
    .split("\n")
    .map((line) => parseIgnoreRule(dirPath, line))
    .filter((rule): rule is IgnoreRule => rule !== undefined);
}

function parseIgnoreRule(baseDir: string, rawLine: string): IgnoreRule | undefined {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;

  const negated = trimmed.startsWith("!");
  let pattern = negated ? trimmed.slice(1).trim() : trimmed;
  if (!pattern || pattern.startsWith("#")) return undefined;

  const directoryOnly = pattern.endsWith("/");
  pattern = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!pattern) return undefined;

  const hasSlash = pattern.includes("/");
  const matcher = hasSlash ? globMatcher(pattern) : filePatternMatcher(pattern);
  return { baseDir, pattern, directoryOnly, hasSlash, negated, matcher };
}

function isIgnored(candidatePath: string, isDirectory: boolean, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    const relative = path.relative(rule.baseDir, candidatePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    if (rule.directoryOnly && !isDirectory) continue;
    if (rule.matcher(relative)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}
