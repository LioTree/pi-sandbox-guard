import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Services } from "../../runtime-state";
import { PolicyDeniedError } from "../../errors";
import { checkPathAccess } from "../../policy/path-policy";
import { decideForTool, textResult } from "../tool-context";

const replacementSchema = Type.Object({
  oldText: Type.String(),
  newText: Type.String(),
});

const editSchema = Type.Object({
  path: Type.String({ description: "Path to edit" }),
  edits: Type.Array(replacementSchema, { description: "Exact text replacements" }),
});

export function createEditTool(getServices: () => Services): ToolDefinition {
  return {
    name: "edit",
    label: "edit",
    description: "Edit a file allowed by pi-sandbox-guard path policy using exact text replacements.",
    promptSnippet: "Edit files through pi-sandbox-guard",
    parameters: editSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params: { path: string; edits: Array<{ oldText: string; newText: string }> }) {
      const services = getServices();
      const absolutePath = path.resolve(services.config.cwd, params.path);
      await decideForTool(services, { kind: "write", tool: "edit", path: absolutePath });
      const readAccess = await checkPathAccess(services.config.pathPolicy, absolutePath, "read");
      if (!readAccess.allowed) {
        throw new PolicyDeniedError(readAccess.reason);
      }

      let content = await readFile(absolutePath, "utf-8");
      for (const edit of params.edits) {
        const count = countOccurrences(content, edit.oldText);
        if (count !== 1) {
          throw new Error(`oldText must match exactly once; got ${count} matches`);
        }
        content = content.replace(edit.oldText, edit.newText);
      }
      await writeFile(absolutePath, content, "utf-8");
      return textResult(`Successfully replaced ${params.edits.length} block(s) in ${params.path}`);
    },
  };
}

function countOccurrences(content: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    index = content.indexOf(needle, index);
    if (index === -1) return count;
    count++;
    index += needle.length;
  }
}
