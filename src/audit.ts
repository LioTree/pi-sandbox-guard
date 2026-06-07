import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type AuditEvent =
  | { type: "config_loaded"; sourcePath: string; enabled: boolean }
  | { type: "config_missing"; cwd: string; checkedPaths: string[] }
  | { type: "config_error"; sourcePath?: string; message: string }
  | { type: "session_ready"; sourcePath: string }
  | { type: "session_disabled"; reason: string }
  | { type: "session_failed"; message: string }
  | { type: "tool_request"; tool: string; kind: string; path?: string; cwd?: string; bypass?: boolean }
  | { type: "policy_decision"; tool: string; decision: string; reason: string }
  | { type: "review_request"; command: string; cwd: string }
  | { type: "review_outcome"; outcome: string; rationale: string }
  | { type: "sandbox_command_exit"; command: string; cwd: string; exitCode: number | null }
  | { type: "sandbox_violation_annotation"; command: string; annotated: boolean };

export type AuditSink = (event: AuditEvent) => void;

export const noopAuditSink: AuditSink = () => {};

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

export function createFileAuditSink(filePath?: string): AuditSink {
  if (!filePath) return noopAuditSink;
  const resolved = filePath.startsWith("~") ? path.join(os.homedir(), filePath.slice(1)) : filePath;
  ensureDir(resolved);
  return (event) => {
    fs.appendFileSync(resolved, `${JSON.stringify(event)}\n`);
  };
}
