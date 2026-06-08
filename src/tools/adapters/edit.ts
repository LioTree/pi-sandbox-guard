import { createEditToolDefinition, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import type { Services } from "../../runtime-state";
import { decideForTool, getToolCwd } from "../tool-context";
import { createEditOperations } from "../guarded-operations";

export function createEditTool(getServices: () => Services): ToolDefinition<any, any, any> {
  const template = createEditToolDefinition("");
  return {
    ...template,
    name: "edit",
    description: `${template.description} Access is constrained by pi-sandbox-guard path policy.`,
    promptSnippet: "Edit files through pi-sandbox-guard",
    renderShell: undefined,
    renderCall: undefined,
    renderResult: undefined,
    async execute(
      toolCallId,
      params: { path: string; edits: Array<{ oldText: string; newText: string }> },
      signal,
      onUpdate,
      ctx,
    ) {
      const services = getServices();
      const cwd = getToolCwd(ctx, services.config.cwd);
      const absolutePath = path.resolve(cwd, params.path);
      await decideForTool(services, { kind: "write", tool: "edit", path: absolutePath });
      const base = createEditToolDefinition(cwd, {
        operations: createEditOperations(services),
      });
      return base.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  };
}
