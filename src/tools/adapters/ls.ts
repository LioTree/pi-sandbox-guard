import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import path from "node:path";
import type { Services } from "../../runtime-state";
import { decideForTool, textResult } from "../tool-context";
import { executeLs } from "../filesystem";

const lsSchema = Type.Object({
  path: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number()),
});

export function createLsTool(getServices: () => Services): ToolDefinition {
  return {
    name: "ls",
    label: "ls",
    description: "List readable directory entries through pi-sandbox-guard path policy.",
    promptSnippet: "List directories through pi-sandbox-guard",
    parameters: lsSchema,
    async execute(_toolCallId, params: { path?: string; limit?: number }) {
      const services = getServices();
      const root = path.resolve(services.config.cwd, params.path ?? ".");
      await decideForTool(services, { kind: "read", tool: "ls", path: root });
      return textResult(await executeLs(services.config.pathPolicy, services.config.cwd, {
        searchPath: params.path,
        limit: params.limit,
      }));
    },
  };
}
