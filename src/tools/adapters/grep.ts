import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import path from "node:path";
import type { Services } from "../../runtime-state";
import { decideForTool, textResult } from "../tool-context";
import { executeGrep } from "../filesystem";

const grepSchema = Type.Object({
  pattern: Type.String(),
  path: Type.Optional(Type.String()),
  glob: Type.Optional(Type.String()),
  ignoreCase: Type.Optional(Type.Boolean()),
  literal: Type.Optional(Type.Boolean()),
  limit: Type.Optional(Type.Number()),
});

export function createGrepTool(getServices: () => Services): ToolDefinition {
  return {
    name: "grep",
    label: "grep",
    description: "Search readable files through pi-sandbox-guard path policy.",
    promptSnippet: "Search file contents through pi-sandbox-guard",
    parameters: grepSchema,
    async execute(
      _toolCallId,
      params: { pattern: string; path?: string; glob?: string; ignoreCase?: boolean; literal?: boolean; limit?: number },
    ) {
      const services = getServices();
      const root = path.resolve(services.config.cwd, params.path ?? ".");
      await decideForTool(services, { kind: "read", tool: "grep", path: root });
      return textResult(await executeGrep(services.config.pathPolicy, services.config.cwd, params.pattern, {
        searchPath: params.path,
        glob: params.glob,
        ignoreCase: params.ignoreCase,
        literal: params.literal,
        limit: params.limit,
      }));
    },
  };
}
