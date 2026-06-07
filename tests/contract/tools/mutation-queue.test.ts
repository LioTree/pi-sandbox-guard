import path from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => {
  const state = {
    delayFirstRead: false,
    delayFirstWrite: false,
    readFileCalls: 0,
    writeFileCalls: 0,
    firstReadStarted: Promise.resolve() as Promise<void>,
    firstWriteStarted: Promise.resolve() as Promise<void>,
    releaseFirstRead: () => {},
    releaseFirstWrite: () => {},
    markFirstReadStarted: () => {},
    markFirstWriteStarted: () => {},
    readMayContinue: Promise.resolve() as Promise<void>,
    writeMayContinue: Promise.resolve() as Promise<void>,
    reset() {
      state.delayFirstRead = false;
      state.delayFirstWrite = false;
      state.readFileCalls = 0;
      state.writeFileCalls = 0;
      state.firstReadStarted = new Promise<void>((resolve) => {
        state.markFirstReadStarted = resolve;
      });
      state.firstWriteStarted = new Promise<void>((resolve) => {
        state.markFirstWriteStarted = resolve;
      });
      state.readMayContinue = new Promise<void>((resolve) => {
        state.releaseFirstRead = resolve;
      });
      state.writeMayContinue = new Promise<void>((resolve) => {
        state.releaseFirstWrite = resolve;
      });
    },
  };
  state.reset();
  return state;
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const actualReadFile = actual.readFile as (...args: unknown[]) => Promise<unknown>;
  const actualWriteFile = actual.writeFile as (...args: unknown[]) => Promise<void>;

  return {
    ...actual,
    readFile: vi.fn(async (...args: unknown[]) => {
      fsMock.readFileCalls++;
      if (fsMock.delayFirstRead && fsMock.readFileCalls === 1) {
        fsMock.markFirstReadStarted();
        await fsMock.readMayContinue;
      }
      return actualReadFile(...args);
    }),
    writeFile: vi.fn(async (...args: unknown[]) => {
      fsMock.writeFileCalls++;
      if (fsMock.delayFirstWrite && fsMock.writeFileCalls === 1) {
        fsMock.markFirstWriteStarted();
        await fsMock.writeMayContinue;
      }
      return actualWriteFile(...args);
    }),
  };
});

const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const { createEditTool } = await import("../../../src/tools/adapters/edit");
const { createWriteTool } = await import("../../../src/tools/adapters/write");
const { effectiveConfig, fakeExtensionContext, makeServices } = await import("../../helpers");

describe("file mutation queue contracts", () => {
  beforeEach(() => {
    fsMock.reset();
    vi.clearAllMocks();
  });

  it("serializes concurrent edits that target the same file", async () => {
    fsMock.delayFirstRead = true;
    const root = await actualFs.mkdtemp(path.join(tmpdir(), "psg-edit-queue-"));
    const target = path.join(root, "note.txt");
    await actualFs.writeFile(target, "first\nsecond\n", "utf-8");
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["edit"], bypass: { mode: "deny" } },
    });
    const tool = createEditTool(() => makeServices(config));
    const ctx = fakeExtensionContext(root);

    const first = tool.execute(
      "call-1",
      { path: target, edits: [{ oldText: "first", newText: "first done" }] },
      undefined,
      undefined,
      ctx,
    );
    await fsMock.firstReadStarted;

    const second = tool.execute(
      "call-2",
      { path: target, edits: [{ oldText: "first done", newText: "first final" }] },
      undefined,
      undefined,
      ctx,
    );
    await delay(50);
    const readCallsWhileFirstEditWasBlocked = fsMock.readFileCalls;

    fsMock.releaseFirstRead();
    const results = await Promise.allSettled([first, second]);

    expect(readCallsWhileFirstEditWasBlocked).toBe(1);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    await expect(actualFs.readFile(target, "utf-8")).resolves.toBe("first final\nsecond\n");
  });

  it("does not serialize writes to different files through a global lock", async () => {
    fsMock.delayFirstWrite = true;
    const root = await actualFs.mkdtemp(path.join(tmpdir(), "psg-write-queue-"));
    const config = effectiveConfig(root, {
      sandbox: { filesystem: { denyRead: [], allowWrite: [root], denyWrite: [] } },
      enforcement: { tools: ["write"], bypass: { mode: "deny" } },
    });
    const tool = createWriteTool(() => makeServices(config));
    const ctx = fakeExtensionContext(root);

    const first = tool.execute("call-1", { path: "one.txt", content: "one" }, undefined, undefined, ctx);
    await fsMock.firstWriteStarted;

    const second = tool.execute("call-2", { path: "two.txt", content: "two" }, undefined, undefined, ctx);
    let writeCallsWhileFirstWriteWasBlocked = 0;
    try {
      await vi.waitFor(() => expect(fsMock.writeFileCalls).toBe(2));
      writeCallsWhileFirstWriteWasBlocked = fsMock.writeFileCalls;
    } finally {
      fsMock.releaseFirstWrite();
    }

    const results = await Promise.allSettled([first, second]);
    expect(writeCallsWhileFirstWriteWasBlocked).toBe(2);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    await expect(actualFs.readFile(path.join(root, "one.txt"), "utf-8")).resolves.toBe("one");
    await expect(actualFs.readFile(path.join(root, "two.txt"), "utf-8")).resolves.toBe("two");
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
