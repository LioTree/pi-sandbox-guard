import type { EffectiveConfig } from "../config/effective";

export function renderPolicyPrompt(config: EffectiveConfig): string {
  const network = config.sandboxRuntime.network;

  return [
    "# pi-sandbox-guard",
    "",
    `Controlled tools: ${config.enforcement.tools.join(", ")}.`,
    `Config source: ${config.sourcePath}`,
    `Working directory for relative policy paths: ${config.cwd}`,
    "Relative paths resolve from the current working directory. ~ resolves to the user home directory.",
    "All controlled filesystem access is governed by sandbox.filesystem. Treat policy denials as authoritative; do not use alternate tools, symlinks, shell tricks, cleanup commands, or bypass requests to work around denied paths.",
    "",
    "Sandbox filesystem policy:",
    "- Read access is default-allow.",
    "- sandbox.filesystem.denyRead removes read, list, and search access for matching paths and contents.",
    "- sandbox.filesystem.allowRead re-allows matching paths inside denyRead.",
    "- allowRead overrides denyRead, but allowRead is not an independent allowlist.",
    "- Write access is default-deny.",
    "- sandbox.filesystem.allowWrite opens write access for matching paths and contents.",
    "- sandbox.filesystem.denyWrite excludes paths from allowed write areas.",
    "- A path is writable only if it matches allowWrite and does not match denyWrite.",
    "- denyWrite protects matching path nodes from creation, deletion, replacement, rename, edit, and git staging changes.",
    "",
    "Configured denyRead:",
    formatRuleList(config.pathPolicy.denyRead),
    "",
    "Configured allowRead:",
    formatRuleList(config.pathPolicy.allowRead),
    "",
    "Configured allowWrite:",
    formatRuleList(config.pathPolicy.allowWrite),
    "",
    "Configured denyWrite:",
    formatRuleList(config.pathPolicy.denyWrite),
    "",
    "Important sandbox artifact warning:",
    "- Sandboxed command output may show protected denyWrite paths as empty placeholder files or directories even when they do not exist on the host.",
    "- Treat these as sandbox artifacts.",
    "- Do not delete, clean up, git-add, edit, rename, or otherwise modify them merely because they appear in ls, find, git status, or other sandboxed output.",
    "",
    "Sandbox network policy:",
    "Allowed domains:",
    formatStringList(network.allowedDomains),
    "Denied domains:",
    formatStringList(network.deniedDomains),
    "",
    "Bypass policy:",
    bypassPolicyLine(config),
  ].join("\n");
}

function bypassPolicyLine(config: EffectiveConfig): string {
  if (config.enforcement.bypass.mode === "review") {
    const reviewerBehavior = config.reviewer?.enabled
      ? "Reviewer decisions fail closed on timeout, errors, invalid output, or rejection."
      : "Reviewer is unavailable or disabled, so bypass requests fail closed.";
    return `- review: bypassSandbox does not directly run on host; it requests reviewer approval for out-of-sandbox execution. ${reviewerBehavior} Do not use bypassSandbox to work around sandbox.filesystem policy denials.`;
  }

  return "- deny: bypassSandbox is denied by configuration; do not set it. Use allowed paths, report the denial, or ask the user to change config.";
}

function formatRuleList(rules: Array<{ raw: string }>): string {
  return formatStringList(rules.map((rule) => rule.raw));
}

function formatStringList(values: string[] | undefined): string {
  return values && values.length > 0 ? values.map((value) => `- ${JSON.stringify(value)}`).join("\n") : "- none";
}
