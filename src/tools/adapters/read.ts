import { createReadToolDefinition, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Services } from "../../runtime-state";
import { createReadOperations } from "../guarded-operations";
import { cloneParametersWithPathDescription } from "./schema";
import { getToolCwd } from "../tool-context";

export function createReadTool(getServices: () => Services): ToolDefinition<any, any, any> {
  const template = createReadToolDefinition("");
  const parameters = cloneParametersWithPathDescription(
    template.parameters as { properties?: { path?: { description?: string } } },
    "Path to the file to read (relative or absolute). Reads follow sandbox.filesystem path policy: read is default-allow, denyRead blocks matching paths, and allowRead can re-allow matches inside denyRead.",
  );
  return {
    ...template,
    name: "read",
    description: `${template.description} Reads follow the shared sandbox.filesystem path policy: read is default-allow, denyRead blocks matching paths, and allowRead can re-allow matches inside denyRead.`,
    promptSnippet: "Read files through pi-sandbox-guard",
    parameters,
    async execute(
      toolCallId: string,
      params: { path: string; offset?: number; limit?: number },
      signal: AbortSignal | undefined,
      onUpdate: any,
      ctx: any,
    ) {
      const services = getServices();
      const cwd = getToolCwd(ctx, services.config.cwd);
      const delegate = createReadToolDefinition(cwd, { operations: createReadOperations(services) });
      return delegate.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  } as unknown as ToolDefinition<any, any, any>;
}
