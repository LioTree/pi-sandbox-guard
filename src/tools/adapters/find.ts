import { createFindToolDefinition, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import type { Services } from "../../runtime-state";
import { decideForTool, getToolCwd } from "../tool-context";
import { createFindOperations } from "../guarded-operations";

export function createFindTool(getServices: () => Services): ToolDefinition<any, any, any> {
  const template = createFindToolDefinition("");
  return {
    ...template,
    name: "find",
    description: `${template.description} Access is constrained by pi-sandbox-guard path policy.`,
    promptSnippet: "Find files through pi-sandbox-guard",
    async execute(
      toolCallId: string,
      params: { pattern: string; path?: string; limit?: number },
      signal: AbortSignal | undefined,
      onUpdate: any,
      ctx: any,
    ) {
      const services = getServices();
      const cwd = getToolCwd(ctx, services.config.cwd);
      const root = path.resolve(cwd, params.path ?? ".");
      await decideForTool(services, { kind: "read", tool: "find", path: root });
      const base = createFindToolDefinition(cwd, {
        operations: createFindOperations(services),
      });
      return base.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  } as unknown as ToolDefinition<any, any, any>;
}
