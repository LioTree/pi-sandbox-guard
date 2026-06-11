import { createWriteToolDefinition, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import type { Services } from "../../runtime-state";
import { decideForTool, getToolCwd } from "../tool-context";
import { createWriteOperations } from "../guarded-operations";
import { cloneParametersWithPathDescription } from "./schema";

export function createWriteTool(getServices: () => Services): ToolDefinition<any, any, any> {
  const template = createWriteToolDefinition("");
  const parameters = cloneParametersWithPathDescription(
    template.parameters as { properties?: { path?: { description?: string } } },
    "Path to the file to write (relative or absolute). Writes follow sandbox.filesystem path policy: write is default-deny, allowWrite opens writable areas, and denyWrite excludes paths inside them.",
  );
  return {
    ...template,
    name: "write",
    description: `${template.description} Writes follow the shared sandbox.filesystem path policy: write is default-deny, allowWrite opens writable areas, and denyWrite excludes paths inside them.`,
    promptSnippet: "Write files through pi-sandbox-guard",
    parameters,
    async execute(
      toolCallId: string,
      params: { path: string; content: string },
      signal: AbortSignal | undefined,
      onUpdate: any,
      ctx: any,
    ) {
      const services = getServices();
      const cwd = getToolCwd(ctx, services.config.cwd);
      const absolutePath = path.resolve(cwd, params.path);
      await decideForTool(services, { kind: "write", tool: "write", path: absolutePath });
      const base = createWriteToolDefinition(cwd, {
        operations: createWriteOperations(services),
      });
      return base.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  } as unknown as ToolDefinition<any, any, any>;
}
