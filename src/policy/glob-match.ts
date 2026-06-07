import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const picomatch = require("picomatch") as PicomatchFactory;

type PicomatchOptions = {
  dot?: boolean;
  nobrace?: boolean;
  nobracket?: boolean;
  noextglob?: boolean;
  nonegate?: boolean;
  bash?: boolean;
  windows?: boolean;
};

type PicomatchMatcher = (input: string) => boolean;
type PicomatchFactory = (pattern: string, options?: PicomatchOptions) => PicomatchMatcher;

export type GlobMatcher = (candidatePath: string) => boolean;

const globOptions: PicomatchOptions = {
  dot: true,
  nobrace: true,
  noextglob: true,
  nonegate: true,
  bash: false,
  windows: false,
};

export function createGlobMatcher(pattern: string): GlobMatcher {
  const normalizedPattern = normalizeForGlob(pattern);
  const matcher = picomatch(normalizedPattern, globOptions);
  return (candidatePath: string) => matcher(normalizeForGlob(candidatePath));
}

export function matchesGlobOrAncestor(targetPath: string, matcher: GlobMatcher): boolean {
  let current = path.resolve(targetPath);

  while (true) {
    if (matcher(current)) {
      return true;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
}

function normalizeForGlob(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}
