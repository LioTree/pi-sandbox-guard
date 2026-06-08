import { constants } from "node:fs";
import { access, mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  EditOperations,
  FindOperations,
  LsOperations,
  ReadOperations,
  WriteOperations,
} from "@earendil-works/pi-coding-agent";
import type { Services } from "../runtime-state";
import { PolicyDeniedError } from "../errors";
import type { ReadToolName, WriteToolName } from "../policy/capability";
import { checkPathAccess, filterReadableChildren } from "../policy/path-policy";
import { filePatternMatcher, walkReadablePaths } from "./filesystem";
import { decideForTool } from "./tool-context";

type GuardCache = Map<string, string>;

async function guardRead(services: Services, tool: ReadToolName, filePath: string, cache: GuardCache): Promise<string> {
  const key = `read:${tool}:${path.resolve(filePath)}`;
  const cached = cache.get(key);
  if (cached) return cached;
  await decideForTool(services, { kind: "read", tool, path: filePath });
  const accessResult = await checkPathAccess(services.config.pathPolicy, filePath, "read");
  if (!accessResult.allowed) throw new PolicyDeniedError(accessResult.reason);
  cache.set(key, accessResult.resolvedPath);
  return accessResult.resolvedPath;
}

async function guardWrite(services: Services, tool: WriteToolName, filePath: string, cache: GuardCache): Promise<string> {
  const key = `write:${tool}:${path.resolve(filePath)}`;
  const cached = cache.get(key);
  if (cached) return cached;
  await decideForTool(services, { kind: "write", tool, path: filePath });
  const accessResult = await checkPathAccess(services.config.pathPolicy, filePath, "write");
  if (!accessResult.allowed) throw new PolicyDeniedError(accessResult.reason);
  cache.set(key, accessResult.resolvedPath);
  return accessResult.resolvedPath;
}

export function createReadOperations(services: Services, cache: GuardCache = new Map()): ReadOperations {
  return {
    access: async (absolutePath) => {
      const resolved = await guardRead(services, "read", absolutePath, cache);
      await access(resolved, constants.R_OK);
    },
    readFile: async (absolutePath) => {
      const resolved = await guardRead(services, "read", absolutePath, cache);
      return readFile(resolved);
    },
    detectImageMimeType: async (absolutePath) => {
      const resolved = await guardRead(services, "read", absolutePath, cache);
      return detectImageMimeType(resolved);
    },
  };
}

export function createWriteOperations(services: Services, cache: GuardCache = new Map()): WriteOperations {
  return {
    mkdir: async (dir) => {
      const resolved = await guardWrite(services, "write", dir, cache);
      await mkdir(resolved, { recursive: true });
    },
    writeFile: async (absolutePath, content) => {
      const resolved = await guardWrite(services, "write", absolutePath, cache);
      await writeFile(resolved, content, "utf-8");
    },
  };
}

export function createEditOperations(services: Services, cache: GuardCache = new Map()): EditOperations {
  return {
    access: async (absolutePath) => {
      let readable: string;
      try {
        readable = await guardRead(services, "edit", absolutePath, cache);
        await guardWrite(services, "edit", absolutePath, cache);
      } catch (error) {
        if (error instanceof PolicyDeniedError) {
          throw new Error(error.message);
        }
        throw error;
      }
      await access(readable, constants.R_OK | constants.W_OK);
    },
    readFile: async (absolutePath) => {
      const resolved = await guardRead(services, "edit", absolutePath, cache);
      return readFile(resolved);
    },
    writeFile: async (absolutePath, content) => {
      const resolved = await guardWrite(services, "edit", absolutePath, cache);
      await writeFile(resolved, content, "utf-8");
    },
  };
}

export function createLsOperations(services: Services, cache: GuardCache = new Map()): LsOperations {
  return {
    exists: async (absolutePath) => {
      try {
        const resolved = await guardRead(services, "ls", absolutePath, cache);
        await access(resolved, constants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    stat: async (absolutePath) => {
      const resolved = await guardRead(services, "ls", absolutePath, cache);
      return stat(resolved);
    },
    readdir: async (absolutePath) => {
      const resolved = await guardRead(services, "ls", absolutePath, cache);
      const entries = await readdir(resolved);
      return filterReadableChildren(services.config.pathPolicy, resolved, entries);
    },
  };
}

export function createFindOperations(services: Services, cache: GuardCache = new Map()): FindOperations {
  return {
    exists: async (absolutePath) => {
      try {
        const resolved = await guardRead(services, "find", absolutePath, cache);
        await access(resolved, constants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    glob: async (pattern, cwd, options) => {
      const root = await guardRead(services, "find", cwd, cache);
      const matcher = filePatternMatcher(pattern);
      const paths = await walkReadablePaths(services.config.pathPolicy, root, options.limit * 2);
      return paths
        .filter((candidate) => {
          const relative = path.relative(root, candidate);
          return relative && matcher(relative);
        })
        .slice(0, options.limit);
    },
  };
}

async function detectImageMimeType(filePath: string): Promise<string | undefined> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const data = buffer.subarray(0, bytesRead);
    if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return "image/png";
    }
    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
      return "image/jpeg";
    }
    if (data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a") {
      return "image/gif";
    }
    if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
      return "image/webp";
    }
    return undefined;
  } finally {
    await handle.close();
  }
}
