import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { CompiledPathPolicy } from "../policy/path-policy";
import { checkPathAccess, filterReadableChildren } from "../policy/path-policy";
import { createGlobMatcher } from "../policy/glob-match";
import { PolicyDeniedError } from "../errors";

export async function walkReadableFiles(
  pathPolicy: CompiledPathPolicy,
  root: string,
  limit: number,
): Promise<string[]> {
  const files: string[] = [];
  const visit = async (current: string): Promise<void> => {
    if (files.length >= limit) return;
    const access = await checkPathAccess(pathPolicy, current, "read");
    if (!access.allowed) {
      return;
    }
    const currentStat = await stat(current);
    if (!currentStat.isDirectory()) {
      files.push(current);
      return;
    }
    const entries = await filterReadableChildren(pathPolicy, current, await readdir(current));
    for (const entry of entries.sort()) {
      if (entry === ".git" || entry === "node_modules") continue;
      await visit(path.join(current, entry));
      if (files.length >= limit) return;
    }
  };
  try {
    await visit(root);
  } catch (error) {
    if (error instanceof PolicyDeniedError) return files;
    throw error;
  }
  return files;
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
    limit?: number;
  } = {},
): Promise<string> {
  const root = path.resolve(cwd, opts.searchPath ?? ".");
  const files = await walkReadableFiles(pathPolicy, root, 2_000);
  const matcher = opts.literal
    ? (line: string) => normalizeCase(line, opts.ignoreCase).includes(normalizeCase(pattern, opts.ignoreCase))
    : createRegexMatcher(pattern, opts.ignoreCase);
  const glob = opts.glob ? filePatternMatcher(opts.glob) : undefined;
  const limit = opts.limit ?? 100;
  const matches: string[] = [];
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
        matches.push(`${relative}:${i + 1}:${lines[i]}`);
        if (matches.length >= limit) {
          return matches.join("\n") + `\n\n[${limit} matches limit reached]`;
        }
      }
    }
  }
  return matches.join("\n") || "No matches";
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
