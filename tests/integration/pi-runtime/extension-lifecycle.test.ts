import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createEventBus,
  createExtensionRuntime,
  ExtensionRunner,
  type ExtensionActions,
  type ExtensionContextActions,
} from "@earendil-works/pi-coding-agent";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { loadExtensionFromFactory } from "./pi-shim";
import sandboxGuardExtension from "../../../src/extension";
import { SandboxSession } from "../../../src/runtime/sandbox-session";

function makeMockActions(): ExtensionActions {
  return {
    sendMessage: () => {},
    sendUserMessage: () => {},
    appendEntry: () => {},
    setSessionName: () => {},
    getSessionName: () => undefined,
    setLabel: () => {},
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => {},
    refreshTools: () => {},
    getCommands: () => [],
    setModel: async () => false,
    getThinkingLevel: () => "off",
    setThinkingLevel: () => {},
  };
}

function makeMockContextActions(): ExtensionContextActions {
  return {
    getModel: () => undefined,
    isIdle: () => true,
    getSignal: () => undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
    getSystemPromptOptions: () => ({ cwd: "" }),
  };
}

async function skipIfUnsupportedSandboxRuntime() {
  if (!SandboxManager.isSupportedPlatform()) {
    console.warn(`skip: sandbox-runtime backend is not supported on ${process.platform}`);
    return true;
  }
  const sandbox = new SandboxSession();
  try {
    await sandbox.initialize({
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    });
    return false;
  } catch (error) {
    console.warn(`skip: sandbox-runtime initialize failed: ${error instanceof Error ? error.message : String(error)}`);
    return true;
  } finally {
    await sandbox.reset();
  }
}

async function skipIfUnsupportedPlatform() {
  if (await skipIfUnsupportedSandboxRuntime()) {
    return true;
  }
  return false;
}

describe("pi-runtime extension lifecycle integration", () => {
  const sessions: ExtensionRunner[] = [];

  afterEach(async () => {
    for (const runner of sessions.splice(0)) {
      await runner.emit({ type: "session_shutdown", reason: "quit" });
    }
  });

  it("loads extension, initializes sandbox, and registers tools on session_start", async () => {
    if (await skipIfUnsupportedPlatform()) return;

    const root = await mkdtemp(path.join(tmpdir(), "psg-pi-"));
    const workDir = path.join(root, "project");
    await mkdir(workDir);
    const piConfigDir = path.join(workDir, ".pi");
    await mkdir(piConfigDir);

    const deniedPath = path.join(root, "secrets");
    await mkdir(deniedPath);
    const secretFile = path.join(deniedPath, "secret.txt");
    await writeFile(secretFile, "top-secret", "utf-8");

    await writeFile(
      path.join(piConfigDir, "sandbox-guard.json"),
      JSON.stringify({
        enabled: true,
        sandbox: {
          network: { allowedDomains: [], deniedDomains: [] },
          filesystem: { denyRead: [deniedPath], allowWrite: [workDir], denyWrite: [deniedPath] },
        },
        enforcement: {
          tools: ["bash", "read"],
          bypass: { mode: "deny" },
        },
      }),
      "utf-8",
    );

    const runtime = createExtensionRuntime();
    const eventBus = createEventBus();
    const sessionManager = SessionManager.inMemory(workDir);
    const settingsManager = SettingsManager.inMemory();
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.create(authStorage);

    const extension = await loadExtensionFromFactory(sandboxGuardExtension, workDir, eventBus, runtime);
    const runner = new ExtensionRunner([extension], runtime, workDir, sessionManager, modelRegistry);
    runner.bindCore(makeMockActions(), makeMockContextActions());
    sessions.push(runner);

    await runner.emit({ type: "session_start", reason: "startup" });

    const bashTool = runner.getToolDefinition("bash");
    const readTool = runner.getToolDefinition("read");
    expect(bashTool).toBeDefined();
    expect(readTool).toBeDefined();
    if (!bashTool || !readTool) return;

    const ctx = runner.createContext();

    const bashResult = await bashTool.execute("test-1", { command: "echo hello-from-sandbox" }, undefined, undefined, ctx);
    expect(bashResult.content).toBeDefined();
    const bashText = (
      bashResult.content.find((c: unknown) => (c as { type: string }).type === "text") as { text?: string } | undefined
    )?.text ?? "";
    expect(bashText).toContain("hello-from-sandbox");

    await expect(
      readTool.execute("test-2", { path: secretFile }, undefined, undefined, ctx),
    ).rejects.toThrow(/denied/);
  });
});
