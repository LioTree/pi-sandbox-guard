import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEditTool } from "../../../src/tools/adapters/edit";
import { createFindTool } from "../../../src/tools/adapters/find";
import { createGrepTool } from "../../../src/tools/adapters/grep";
import { createLsTool } from "../../../src/tools/adapters/ls";
import { createWriteTool } from "../../../src/tools/adapters/write";
import { SandboxSession } from "../../../src/runtime/sandbox-session";
import { effectiveConfig, fakeExtensionContext, fakeSandboxManager, makeServices, toolText } from "../../helpers";
import type { EffectiveConfig } from "../../../src/config/effective";

describe("filesystem tool contracts", () => {
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
    let wrappedCommand = "";
    let cleanupCount = 0;
    const services = await makeInitializedServices(config, {
      wrapWithSandboxArgv: async (command: string) => {
        wrappedCommand = command;
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

    expect(wrappedCommand).toContain("rg --json");
    expect(text).toContain("visible.txt");
    expect(cleanupCount).toBe(1);
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

  it("find filters denied files and directories", async () => {
    const { root, deniedDir } = await createSearchTree();
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [deniedDir], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["find"], bypass: { mode: "deny" } },
    });
    const tool = createFindTool(() => makeServices(config));

    const text = toolText(
      await tool.execute("call-1", { pattern: "*.txt", path: root }, undefined, undefined, fakeExtensionContext(root)),
    );

    expect(text).toContain("visible.txt");
    expect(text).not.toContain("secret.txt");
    expect(text).not.toContain("denied");
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
    const findText = toolText(
      await createFindTool(() => makeServices(config)).execute(
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

  it("ls filters denied child entries", async () => {
    const { root, deniedDir } = await createSearchTree();
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [deniedDir], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["ls"], bypass: { mode: "deny" } },
    });
    const tool = createLsTool(() => makeServices(config));

    const text = toolText(await tool.execute("call-1", { path: root }, undefined, undefined, fakeExtensionContext(root)));

    expect(text).toContain("public");
    expect(text).not.toContain("denied");
  });
});

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
