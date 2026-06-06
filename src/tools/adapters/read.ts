import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import path from "node:path";
import type { Services } from "../../runtime-state";
import { decideForTool, textResult } from "../tool-context";
import { executeRead } from "../filesystem";

const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start from, 1-indexed" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export function createReadTool(getServices: () => Services): ToolDefinition {
  return {
    name: "read",
    label: "read",
    description: "Read a file allowed by pi-sandbox-guard path policy.",
    promptSnippet: "Read files through pi-sandbox-guard",
    parameters: readSchema,
    async execute(_toolCallId, params: { path: string; offset?: number; limit?: number }) {
      const services = getServices();
      const absolutePath = path.resolve(services.config.cwd, params.path);
      await decideForTool(services, { kind: "read", tool: "read", path: absolutePath });
      return textResult(await executeRead(
        services.config.pathPolicy,
        services.config.cwd,
        params.path,
        params.offset,
        params.limit,
      ));
    },
  };
}
