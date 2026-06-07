import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGlobMatcher, matchesGlobOrAncestor } from "../../../src/policy/glob-match";

describe("glob matcher", () => {
  it("matches **/ patterns at both the cwd root and nested levels", () => {
    const matcher = createGlobMatcher("/repo/**/.env");

    expect(matcher("/repo/.env")).toBe(true);
    expect(matcher("/repo/app/.env")).toBe(true);
    expect(matcher("/outside/.env")).toBe(false);
  });

  it("treats a matching ancestor directory as a match for descendants", () => {
    const matcher = createGlobMatcher("/repo/**/.git");

    expect(matchesGlobOrAncestor("/repo/.git", matcher)).toBe(true);
    expect(matchesGlobOrAncestor("/repo/.git/hooks/pre-commit", matcher)).toBe(true);
    expect(matchesGlobOrAncestor("/repo/app/.git/hooks/post-checkout", matcher)).toBe(true);
    expect(matchesGlobOrAncestor("/repo/app/.config/hooks/post-checkout", matcher)).toBe(false);
  });

  it("normalizes platform separators before matching", () => {
    const matcher = createGlobMatcher(path.join("/repo", "**", ".pi"));
    const target = path.join("/repo", "nested", ".pi", "extensions", "backdoor.ts");

    expect(matchesGlobOrAncestor(target, matcher)).toBe(true);
  });
});
