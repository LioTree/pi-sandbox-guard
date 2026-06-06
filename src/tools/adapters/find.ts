import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import path from "node:path";
import type { Services } from "../../runtime-state";
import { decideForTool, textResult } from "../tool-context";
import { executeFind } from "../filesystem";

const findSchema = Type.Object({
  pattern: Type.String(),
  path: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number()),
});

export function createFindTool(getServices: () => Services): ToolDefinition {
  return {
    name: "find",
    label: "find",
    description: "Find readable files through pi-sandbox-guard path policy.",
    promptSnippet: "Find files through pi-sandbox-guard",
    parameters: findSchema,
    async execute(_toolCallId, params: { pattern: string; path?: string; limit?: number }) {
      const services = getServices();
      const root = path.resolve(services.config.cwd, params.path ?? ".");
      await decideForTool(services, { kind: "read", tool: "find", path: root });
      return textResult(await executeFind(services.config.pathPolicy, services.config.cwd, params.pattern, {
        searchPath: params.path,
        limit: params.limit,
      }));
    },
  };
}
