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

export function createConsoleAuditSink(): AuditSink {
  return (event) => {
    process.stderr.write(`[pi-sandbox-guard] ${JSON.stringify(event)}\n`);
  };
}
