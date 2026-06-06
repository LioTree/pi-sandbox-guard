import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { BuiltinToolName } from "../../config/effective";
import type { Services } from "../../runtime-state";
import { createBashTool } from "./bash";
import { createEditTool } from "./edit";
import { createReadTool } from "./read";
import { createGrepTool } from "./grep";
import { createFindTool } from "./find";
import { createLsTool } from "./ls";
import { createWriteTool } from "./write";

export function createSandboxGuardTools(getServices: () => Services, toolNames: BuiltinToolName[]): ToolDefinition[] {
  const factories: Record<BuiltinToolName, () => ToolDefinition> = {
    bash: () => createBashTool(getServices),
    read: () => createReadTool(getServices),
    write: () => createWriteTool(getServices),
    edit: () => createEditTool(getServices),
    grep: () => createGrepTool(getServices),
    find: () => createFindTool(getServices),
    ls: () => createLsTool(getServices),
  };
  return toolNames.map((toolName) => factories[toolName]());
}
