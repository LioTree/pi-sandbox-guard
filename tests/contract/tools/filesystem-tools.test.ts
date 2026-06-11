import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEditTool } from "../../../src/tools/adapters/edit";
import { createFindTool } from "../../../src/tools/adapters/find";
import { createGrepTool } from "../../../src/tools/adapters/grep";
import { createLsTool } from "../../../src/tools/adapters/ls";
import { createReadTool } from "../../../src/tools/adapters/read";
import { createWriteTool } from "../../../src/tools/adapters/write";
import { SandboxSession } from "../../../src/runtime/sandbox-session";
import { effectiveConfig, fakeExtensionContext, fakeSandboxManager, makeServices, toolText } from "../../helpers";
import type { EffectiveConfig } from "../../../src/config/effective";

describe("filesystem tool contracts", () => {
  it("does not mutate Pi built-in read/write/edit path schema descriptions", () => {
    const originalReadPath = getPathDescription(createReadToolDefinition(""));
    const originalWritePath = getPathDescription(createWriteToolDefinition(""));
    const originalEditPath = getPathDescription(createEditToolDefinition(""));

    const readTool = createReadToolDefinition("");
    const writeTool = createWriteToolDefinition("");
    const editTool = createEditToolDefinition("");

    createReadTool(() => {
      throw new Error("services should not be used when reading schema");
    });
    createWriteTool(() => {
      throw new Error("services should not be used when reading schema");
    });
    const guardedEditTool = createEditTool(() => {
      throw new Error("services should not be used when reading schema");
    });

    expect(getPathDescription(createReadToolDefinition(""))).toBe(originalReadPath);
    expect(getPathDescription(createWriteToolDefinition(""))).toBe(originalWritePath);
    expect(getPathDescription(createEditToolDefinition(""))).toBe(originalEditPath);

    expect(getPathDescription(readTool)).toBe(originalReadPath);
    expect(getPathDescription(writeTool)).toBe(originalWritePath);
    expect(getPathDescription(editTool)).toBe(originalEditPath);
    expect(guardedEditTool.description).toContain("Edits require both read and write access");
    expect(getPathDescription(guardedEditTool)).toContain("Edits require both read and write access");
    expect(getPathDescription(guardedEditTool)).toContain("Reads follow sandbox.filesystem path policy");
    expect(getPathDescription(guardedEditTool)).toContain("Writes follow sandbox.filesystem path policy");
  });

  it("write enters policy before touching the filesystem", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-write-tool-"));
    const target = path.join(root, "denied", "out.txt");
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [path.join(root, "allowed")], denyWrite: [] } },
      enforcement: { tools: ["write"], bypass: { mode: "deny" } },
    });
    const tool = createWriteTool(() => makeServices(config));

    await expect(
      tool.execute("call-1", { path: target, content: "should-not-write" }, undefined, undefined, fakeExtensionContext(root)),
    ).rejects.toThrow(/write not allowed/);
    await expect(stat(target)).rejects.toThrow();
  });

  it("edit requires both write and read permission before modifying a file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-edit-tool-"));
    const target = path.join(root, "note.txt");
    await writeFile(target, "original", "utf-8");
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [target], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["edit"], bypass: { mode: "deny" } },
    });
    const tool = createEditTool(() => makeServices(config));

    await expect(
      tool.execute(
        "call-1",
        { path: target, edits: [{ oldText: "original", newText: "modified" }] },
        undefined,
        undefined,
        fakeExtensionContext(root),
      ),
    ).rejects.toThrow(/read denied/);
    await expect(readFile(target, "utf-8")).resolves.toBe("original");
  });

  it("grep denies disallowed search roots before running rg", async () => {
    const { root, deniedDir } = await createSearchTree();
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [deniedDir], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["grep"], bypass: { mode: "deny" } },
    });
    const tool = createGrepTool(() => makeServices(config));

    await expect(
      tool.execute("call-1", { pattern: "needle", path: deniedDir, literal: true }, undefined, undefined, fakeExtensionContext(root)),
    ).rejects.toThrow(/read denied/);
  });

  it("grep runs ripgrep through the sandbox wrapper", async () => {
    const { root } = await createSearchTree();
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["grep"], bypass: { mode: "deny" } },
    });
    let wrapCalls = 0;
    let cleanupCount = 0;
    const services = await makeInitializedServices(config, {
      wrapWithSandboxArgv: async (command: string) => {
        wrapCalls++;
        return { argv: [process.env.SHELL ?? "sh", "-lc", command], env: {} };
      },
      cleanupAfterCommand: () => {
        cleanupCount++;
      },
    });
    const tool = createGrepTool(() => services);

    const text = toolText(
      await tool.execute("call-1", { pattern: "needle", path: root, literal: true }, undefined, undefined, fakeExtensionContext(root)),
    );

    expect(wrapCalls).toBe(1);
    expect(text).toContain("visible.txt");
    expect(cleanupCount).toBe(1);
  });

  it("grep preserves ripgrep bang glob exclusions with quoted path segments", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-grep-bang-glob-"));
    const visibleDir = path.join(root, "visible");
    const skippedDir = path.join(root, "weird ' skip");
    await mkdir(visibleDir);
    await mkdir(skippedDir);
    await writeFile(path.join(visibleDir, "visible.txt"), "needle visible", "utf-8");
    await writeFile(path.join(skippedDir, "ignored.txt"), "needle ignored", "utf-8");
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["grep"], bypass: { mode: "deny" } },
    });
    const services = await makeInitializedServices(config);
    const tool = createGrepTool(() => services);

    const text = toolText(
      await tool.execute(
        "call-1",
        { pattern: "needle", path: root, glob: "!**/weird ' skip/*.txt", literal: true },
        undefined,
        undefined,
        fakeExtensionContext(root),
      ),
    );

    expect(text).toContain("visible.txt");
    expect(text).toContain("needle visible");
    expect(text).not.toContain("ignored.txt");
    expect(text).not.toContain("needle ignored");
  });

  it("grep supports context and truncates long match lines", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-grep-tool-"));
    const target = path.join(root, "visible.txt");
    await writeFile(target, ["before", `needle ${"x".repeat(80)}`, "after"].join("\n"), "utf-8");
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["grep"], bypass: { mode: "deny" } },
    });
    config.toolOutput.grepMaxLineChars = 20;
    const services = await makeInitializedServices(config);
    const tool = createGrepTool(() => services);

    const result = await tool.execute(
      "call-1",
      { pattern: "needle", path: root, literal: true, context: 1 },
      undefined,
      undefined,
      fakeExtensionContext(root),
    );
    const text = toolText(result);

    expect(text).toContain("visible.txt-1- before");
    expect(text).toContain("visible.txt:2: needle");
    expect(text).toContain("... [truncated]");
    expect(text).toContain("visible.txt-3- after");
    expect((result.details as { linesTruncated?: boolean } | undefined)?.linesTruncated).toBe(true);
  });

  it("grep treats rg exit 1 as no matches and reports rg errors", async () => {
    const { root } = await createSearchTree();
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["grep"], bypass: { mode: "deny" } },
    });
    const services = await makeInitializedServices(config);
    const tool = createGrepTool(() => services);

    const noMatch = toolText(
      await tool.execute("call-1", { pattern: "absent", path: root, literal: true }, undefined, undefined, fakeExtensionContext(root)),
    );
    expect(noMatch).toBe("No matches found");

    await expect(
      tool.execute("call-2", { pattern: "[", path: root }, undefined, undefined, fakeExtensionContext(root)),
    ).rejects.toThrow();
  });

  it("grep returns parsed matches even when rg exits with an error", async () => {
    const { root } = await createSearchTree();
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["grep"], bypass: { mode: "deny" } },
    });
    const matchEvent = JSON.stringify({
      type: "match",
      data: {
        path: { text: path.join(root, "public", "visible.txt") },
        lines: { text: "needle visible\n" },
        line_number: 1,
      },
    });
    const services = await makeInitializedServices(config, {
      wrapWithSandboxArgv: async () => ({
        argv: [process.env.SHELL ?? "sh", "-lc", `printf '%s\n' '${matchEvent}' >&1; printf 'rg: denied: Permission denied\n' >&2; exit 2`],
        env: {},
      }),
    });
    const tool = createGrepTool(() => services);

    const text = toolText(
      await tool.execute("call-1", { pattern: "needle", path: root, literal: true }, undefined, undefined, fakeExtensionContext(root)),
    );

    expect(text).toContain("public/visible.txt:1: needle visible");
    expect(text).toContain("rg exited with code 2; results may be incomplete");
  });

  it("grep reports signal termination without a null exit-code notice", async () => {
    const { root } = await createSearchTree();
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["grep"], bypass: { mode: "deny" } },
    });
    const matchEvent = JSON.stringify({
      type: "match",
      data: {
        path: { text: path.join(root, "public", "visible.txt") },
        lines: { text: "needle visible\n" },
        line_number: 1,
      },
    });
    const services = await makeInitializedServices(config, {
      wrapWithSandboxArgv: async () => ({
        argv: [process.execPath, "-e", `process.stdout.write(${JSON.stringify(`${matchEvent}\n`)}); process.kill(process.pid, "SIGTERM");`],
        env: {},
      }),
    });
    const tool = createGrepTool(() => services);

    const text = toolText(
      await tool.execute("call-1", { pattern: "needle", path: root, literal: true }, undefined, undefined, fakeExtensionContext(root)),
    );

    expect(text).toContain("rg was terminated; results may be incomplete");
    expect(text).not.toContain("code null");
  });

  it("find denies disallowed search roots before running fd", async () => {
    const { root, deniedDir } = await createSearchTree();
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [deniedDir], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["find"], bypass: { mode: "deny" } },
    });
    const services = await makeInitializedServices(config);
    const tool = createFindTool(() => services);

    await expect(
      tool.execute("call-1", { pattern: "*.txt", path: deniedDir }, undefined, undefined, fakeExtensionContext(root)),
    ).rejects.toThrow(/read denied/);
  });

  it("find runs fd through the sandbox wrapper", async () => {
    const { root } = await createSearchTree();
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["find"], bypass: { mode: "deny" } },
    });
    let wrapCalls = 0;
    let cleanupCount = 0;
    const services = await makeInitializedServices(config, {
      wrapWithSandboxArgv: async (command: string) => {
        wrapCalls++;
        return { argv: [process.env.SHELL ?? "sh", "-lc", command], env: {} };
      },
      cleanupAfterCommand: () => {
        cleanupCount++;
      },
    });
    const tool = createFindTool(() => services);

    const text = toolText(
      await tool.execute("call-1", { pattern: "*.txt", path: root }, undefined, undefined, fakeExtensionContext(root)),
    );

    expect(wrapCalls).toBe(1);
    expect(text).toContain("public/visible.txt");
    expect(cleanupCount).toBe(1);
  });

  it("find preserves trailing spaces in returned paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-find-space-"));
    const publicDir = path.join(root, "public");
    await mkdir(publicDir);
    await writeFile(path.join(publicDir, "trailing-space "), "", "utf-8");
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["find"], bypass: { mode: "deny" } },
    });
    const services = await makeInitializedServices(config);
    const tool = createFindTool(() => services);

    const text = toolText(
      await tool.execute("call-1", { pattern: "trailing-space*", path: root }, undefined, undefined, fakeExtensionContext(root)),
    );

    expect(text).toBe("public/trailing-space ");
  });

  it("find only reports limit reached when fd returns more than the requested limit", async () => {
    const oneRoot = await mkdtemp(path.join(tmpdir(), "psg-find-limit-one-"));
    await writeFile(path.join(oneRoot, "one.txt"), "", "utf-8");
    const oneConfig = effectiveConfig(oneRoot, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [oneRoot], denyWrite: [] } },
      enforcement: { tools: ["find"], bypass: { mode: "deny" } },
    });
    const oneServices = await makeInitializedServices(oneConfig);
    const oneResultText = toolText(
      await createFindTool(() => oneServices).execute(
        "call-1",
        { pattern: "*.txt", path: oneRoot, limit: 1 },
        undefined,
        undefined,
        fakeExtensionContext(oneRoot),
      ),
    );

    const twoRoot = await mkdtemp(path.join(tmpdir(), "psg-find-limit-two-"));
    await writeFile(path.join(twoRoot, "a.txt"), "", "utf-8");
    await writeFile(path.join(twoRoot, "b.txt"), "", "utf-8");
    const twoConfig = effectiveConfig(twoRoot, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [twoRoot], denyWrite: [] } },
      enforcement: { tools: ["find"], bypass: { mode: "deny" } },
    });
    const twoServices = await makeInitializedServices(twoConfig);
    const twoResultText = toolText(
      await createFindTool(() => twoServices).execute(
        "call-2",
        { pattern: "*.txt", path: twoRoot, limit: 1 },
        undefined,
        undefined,
        fakeExtensionContext(twoRoot),
      ),
    );

    expect(oneResultText).not.toContain("results limit reached");
    expect(twoResultText).toContain("1 results limit reached");
    const visibleLimitedResults = ["a.txt", "b.txt"].filter((name) => twoResultText.includes(name));
    expect(visibleLimitedResults).toHaveLength(1);
  });

  it("find accepts slash patterns with a leading ./", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-find-dot-slash-"));
    const srcDir = path.join(root, "src");
    await mkdir(srcDir);
    await writeFile(path.join(srcDir, "a.ts"), "", "utf-8");
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["find"], bypass: { mode: "deny" } },
    });
    const services = await makeInitializedServices(config);
    const tool = createFindTool(() => services);

    const text = toolText(await tool.execute("call-1", { pattern: "./src/*.ts", path: root }, undefined, undefined, fakeExtensionContext(root)));

    expect(text).toContain("src/a.ts");
  });

  it("grep and find respect readable .gitignore files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-ignore-tool-"));
    await writeFile(path.join(root, ".gitignore"), "ignored.txt\nignored-dir/\n", "utf-8");
    await writeFile(path.join(root, "visible.txt"), "needle visible", "utf-8");
    await writeFile(path.join(root, "ignored.txt"), "needle ignored", "utf-8");
    const ignoredDir = path.join(root, "ignored-dir");
    await mkdir(ignoredDir);
    await writeFile(path.join(ignoredDir, "nested.txt"), "needle nested", "utf-8");
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["grep", "find"], bypass: { mode: "deny" } },
    });

    const grepServices = await makeInitializedServices(config);
    const grepText = toolText(
      await createGrepTool(() => grepServices).execute(
        "call-1",
        { pattern: "needle", path: root, literal: true },
        undefined,
        undefined,
        fakeExtensionContext(root),
      ),
    );
    const findServices = await makeInitializedServices(config);
    const findText = toolText(
      await createFindTool(() => findServices).execute(
        "call-2",
        { pattern: "*.txt", path: root },
        undefined,
        undefined,
        fakeExtensionContext(root),
      ),
    );

    expect(grepText).toContain("visible.txt");
    expect(grepText).not.toContain("ignored.txt");
    expect(grepText).not.toContain("nested.txt");
    expect(findText).toContain("visible.txt");
    expect(findText).not.toContain("ignored.txt");
    expect(findText).not.toContain("nested.txt");
  });

  it("ls denies disallowed roots before running sandboxed ls", async () => {
    const { root, deniedDir } = await createSearchTree();
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [deniedDir], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["ls"], bypass: { mode: "deny" } },
    });
    let wrapCalls = 0;
    const services = await makeInitializedServices(config, {
      wrapWithSandboxArgv: async () => {
        wrapCalls++;
        return { argv: [process.env.SHELL ?? "sh", "-lc", "printf 'should-not-run\\n'"], env: {} };
      },
    });
    const tool = createLsTool(() => services);

    await expect(tool.execute("call-1", { path: deniedDir }, undefined, undefined, fakeExtensionContext(root))).rejects.toThrow(
      /read denied/,
    );
    expect(wrapCalls).toBe(0);
  });

  it("ls may show denied child names while protecting denied directory contents", async () => {
    const { root, deniedDir } = await createSearchTree();
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [deniedDir], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["ls"], bypass: { mode: "deny" } },
    });
    let wrapCalls = 0;
    let cleanupCount = 0;
    const services = await makeInitializedServices(config, {
      wrapWithSandboxArgv: async () => {
        wrapCalls++;
        return { argv: [process.env.SHELL ?? "sh", "-lc", "printf 'denied/\\npublic/\\n'"], env: {} };
      },
      cleanupAfterCommand: () => {
        cleanupCount++;
      },
    });
    const tool = createLsTool(() => services);

    const text = toolText(await tool.execute("call-1", { path: root }, undefined, undefined, fakeExtensionContext(root)));

    expect(wrapCalls).toBe(1);
    expect(text).toContain("public/");
    expect(text).toContain("denied/");
    expect(text).not.toContain("secret.txt");
    expect(cleanupCount).toBe(1);
  });
});

function getPathDescription(tool: { parameters?: unknown }): string | undefined {
  return (tool.parameters as { properties?: { path?: { description?: string } } } | undefined)?.properties?.path?.description;
}

async function makeInitializedServices(
  config: EffectiveConfig,
  managerOverrides: Parameters<typeof fakeSandboxManager>[0] = {},
): Promise<ReturnType<typeof makeServices>> {
  const sandbox = new SandboxSession(fakeSandboxManager(managerOverrides));
  await sandbox.initialize(config.sandboxRuntime);
  return makeServices(config, { sandbox });
}

async function createSearchTree(): Promise<{ root: string; deniedDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "psg-search-tool-"));
  const publicDir = path.join(root, "public");
  const deniedDir = path.join(root, "denied");
  await mkdir(publicDir);
  await mkdir(deniedDir);
  await writeFile(path.join(publicDir, "visible.txt"), "needle visible", "utf-8");
  await writeFile(path.join(deniedDir, "secret.txt"), "needle secret", "utf-8");
  return { root, deniedDir };
}
