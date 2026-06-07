import { withFileMutationQueue, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Services } from "../../runtime-state";
import { decideForTool, textResult } from "../tool-context";

const writeSchema = Type.Object({
  path: Type.String({ description: "Path to write" }),
  content: Type.String({ description: "Content to write" }),
});

export function createWriteTool(getServices: () => Services): ToolDefinition {
  return {
    name: "write",
    label: "write",
    description: "Write a file allowed by pi-sandbox-guard path policy.",
    promptSnippet: "Write files through pi-sandbox-guard",
    parameters: writeSchema,
    async execute(_toolCallId, params: { path: string; content: string }) {
      const services = getServices();
      const absolutePath = path.resolve(services.config.cwd, params.path);
      await decideForTool(services, { kind: "write", tool: "write", path: absolutePath });
      return withFileMutationQueue(absolutePath, async () => {
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, params.content, "utf-8");
        return textResult(`Successfully wrote ${params.content.length} bytes to ${params.path}`);
      });
    },
  };
}
