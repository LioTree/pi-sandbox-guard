import { createLsToolDefinition, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import type { Services } from "../../runtime-state";
import { decideForTool, getToolCwd } from "../tool-context";
import { createLsOperations } from "../guarded-operations";

export function createLsTool(getServices: () => Services): ToolDefinition<any, any, any> {
  const template = createLsToolDefinition("");
  return {
    ...template,
    name: "ls",
    description: `${template.description} Access is constrained by pi-sandbox-guard path policy.`,
    promptSnippet: "List directories through pi-sandbox-guard",
    async execute(
      toolCallId: string,
      params: { path?: string; limit?: number },
      signal: AbortSignal | undefined,
      onUpdate: any,
      ctx: any,
    ) {
      const services = getServices();
      const cwd = getToolCwd(ctx, services.config.cwd);
      const root = path.resolve(cwd, params.path ?? ".");
      await decideForTool(services, { kind: "read", tool: "ls", path: root });
      const base = createLsToolDefinition(cwd, {
        operations: createLsOperations(services),
      });
      return base.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  } as unknown as ToolDefinition<any, any, any>;
}
