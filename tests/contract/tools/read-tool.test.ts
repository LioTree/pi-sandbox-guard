import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createReadTool } from "../../../src/tools/adapters/read";
import { effectiveConfig, fakeExtensionContext, makeServices } from "../../helpers";

describe("read tool contract", () => {
  it("enters policy before reading the filesystem", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-read-tool-"));
    const denied = path.join(root, "denied.txt");
    await writeFile(denied, "secret", "utf-8");

    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [denied], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["read"], bypass: { mode: "deny" } },
    });
    const tool = createReadTool(() => makeServices(config));

    await expect(
      tool.execute("call-1", { path: denied }, undefined, undefined, fakeExtensionContext(root)),
    ).rejects.toThrow(/read denied/);
  });

  it("uses Pi read truncation notices for large text files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-read-tool-"));
    const target = path.join(root, "large.txt");
    const content = Array.from({ length: 2_005 }, (_value, index) => `line-${index + 1}`).join("\n");
    await writeFile(target, content, "utf-8");
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["read"], bypass: { mode: "deny" } },
    });
    const tool = createReadTool(() => makeServices(config));

    const result = await tool.execute("call-1", { path: target }, undefined, undefined, fakeExtensionContext(root));
    const text = result.content.find((item) => item.type === "text")?.text ?? "";

    expect(text).toContain("line-1");
    expect(text).toContain("line-2000");
    expect(text).not.toContain("line-2001");
    expect(text).toContain("Use offset=2001 to continue");
    expect((result.details as { truncation?: { truncated?: boolean } } | undefined)?.truncation?.truncated).toBe(true);
  });
});
