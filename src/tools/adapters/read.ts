import { createReadToolDefinition, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Services } from "../../runtime-state";
import { createReadOperations } from "../guarded-operations";
import { getToolCwd } from "../tool-context";

export function createReadTool(getServices: () => Services): ToolDefinition<any, any, any> {
  const template = createReadToolDefinition("");
  return {
    ...template,
    name: "read",
    description: `${template.description} Access is constrained by pi-sandbox-guard path policy.`,
    promptSnippet: "Read files through pi-sandbox-guard",
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
