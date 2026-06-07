import type {
  EventBus,
  Extension,
  ExtensionAPI,
  ExtensionFactory,
  ExtensionRuntime,
  RegisteredTool,
} from "@earendil-works/pi-coding-agent";
import { createSyntheticSourceInfo } from "@earendil-works/pi-coding-agent";

/**
 * Minimal replica of the Pi SDK's `loadExtensionFromFactory` (not part of the
 * public API). Creates the extension maps, calls the factory function, and
 * returns a populated Extension object ready for ExtensionRunner.
 */
export async function loadExtensionFromFactory(
  factory: ExtensionFactory,
  cwd: string,
  _eventBus: EventBus,
  runtime: ExtensionRuntime,
  extensionPath?: string,
): Promise<Extension> {
  const extPath = extensionPath ?? "<inline>";
  const sourceInfo = createSyntheticSourceInfo(extPath, { source: "inline" });

  const handlers = new Map<string, Array<(event: unknown, ctx?: unknown) => unknown | Promise<unknown>>>();
  const tools = new Map<string, RegisteredTool>();
  const commands = new Map();
  const flags = new Map();
  const shortcuts = new Map();
  const messageRenderers = new Map();

  const api: Record<string, unknown> = {
    on(event: string, handler: unknown) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler as (event: unknown, ctx?: unknown) => unknown);
      handlers.set(event, existing);
    },

    registerTool(tool: { name: string }) {
      runtime.assertActive();
      tools.set(tool.name, { definition: tool, sourceInfo } as RegisteredTool);
    },

    registerFlag(name: string, options: { default?: boolean | string }) {
      if (options.default !== undefined) {
        runtime.flagValues.set(name, options.default);
      }
      flags.set(name, options);
    },

    getFlag(name: string) {
      return runtime.flagValues.get(name);
    },

    registerCommand() {},
    registerShortcut() {},
    registerMessageRenderer() {},
    sendMessage() {},
    sendUserMessage() {},
    appendEntry() {},
    setSessionName() {},
    getSessionName() {
      return undefined;
    },
    setLabel() {},
    exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    getActiveTools() {
      return [];
    },
    getAllTools() {
      return [];
    },
    setActiveTools() {},
    getCommands() {
      return [];
    },
    setModel: async () => false,
    getThinkingLevel() {
      return "off";
    },
    setThinkingLevel() {},
    registerProvider() {},
    unregisterProvider() {},
  };

  await factory(api as unknown as ExtensionAPI);

  return {
    path: extPath,
    resolvedPath: extPath,
    sourceInfo,
    handlers,
    tools,
    commands,
    flags,
    shortcuts,
    messageRenderers,
  } as Extension;
}
