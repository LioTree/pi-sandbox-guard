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
});
