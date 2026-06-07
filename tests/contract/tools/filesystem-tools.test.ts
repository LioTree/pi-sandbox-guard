import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEditTool } from "../../../src/tools/adapters/edit";
import { createFindTool } from "../../../src/tools/adapters/find";
import { createGrepTool } from "../../../src/tools/adapters/grep";
import { createLsTool } from "../../../src/tools/adapters/ls";
import { createWriteTool } from "../../../src/tools/adapters/write";
import { effectiveConfig, fakeExtensionContext, makeServices, toolText } from "../../helpers";

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

  it("grep filters denied files and does not leak their content", async () => {
    const { root, deniedDir } = await createSearchTree();
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [deniedDir], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["grep"], bypass: { mode: "deny" } },
    });
    const tool = createGrepTool(() => makeServices(config));

    const text = toolText(
      await tool.execute("call-1", { pattern: "needle", path: root, literal: true }, undefined, undefined, fakeExtensionContext(root)),
    );

    expect(text).toContain("visible.txt");
    expect(text).toContain("needle visible");
    expect(text).not.toContain("secret.txt");
    expect(text).not.toContain("needle secret");
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
