import type { BuiltinToolName } from "../config/effective";

export type ReadToolName = "read" | "grep" | "find" | "ls";
export type WriteToolName = "write" | "edit";

export type CapabilityRequest =
  | { kind: "read"; path: string; tool: ReadToolName }
  | { kind: "write"; path: string; tool: WriteToolName }
  | { kind: "shell"; command: string; cwd: string; bypass: boolean; tool: "bash" };

export type ToolCapabilityKind = CapabilityRequest["kind"];

export function capabilityToolName(request: CapabilityRequest): BuiltinToolName {
  return request.tool;
}
