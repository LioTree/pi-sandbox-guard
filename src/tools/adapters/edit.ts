import { createEditToolDefinition, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import type { Services } from "../../runtime-state";
import { decideForTool, getToolCwd } from "../tool-context";
import { createEditOperations } from "../guarded-operations";
import { cloneParametersWithPathDescription } from "./schema";

export function createEditTool(getServices: () => Services): ToolDefinition<any, any, any> {
  const template = createEditToolDefinition("");
  const parameters = cloneParametersWithPathDescription(
    template.parameters as { properties?: { path?: { description?: string } } },
    "Path to the file to edit (relative or absolute). Edits require both read and write access. Reads follow sandbox.filesystem path policy: read is default-allow, denyRead blocks matching paths, and allowRead can re-allow matches inside denyRead. Writes follow sandbox.filesystem path policy: write is default-deny, allowWrite opens writable areas, and denyWrite excludes paths inside them.",
  );
  return {
    ...template,
    name: "edit",
    description:
      `${template.description} Edits require both read and write access. Reads follow the shared sandbox.filesystem path policy: read is default-allow, denyRead blocks matching paths, and allowRead can re-allow matches inside denyRead. Writes follow the shared sandbox.filesystem path policy: write is default-deny, allowWrite opens writable areas, and denyWrite excludes paths inside them.`,
    promptSnippet: "Edit files through pi-sandbox-guard",
    parameters,
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
