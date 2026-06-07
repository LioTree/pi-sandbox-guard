import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { rawConfig } from "../../helpers";

const mockHome = vi.hoisted(() => ({ dir: "" }));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => mockHome.dir,
  };
});

const { loadEffectiveConfig } = await import("../../../src/config/load");

describe("loadEffectiveConfig", () => {
  it("uses project config before global config without merging", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-config-load-"));
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    mockHome.dir = home;

    await mkdir(path.join(cwd, ".pi"), { recursive: true });
    await mkdir(path.join(home, ".pi", "agent"), { recursive: true });

    const projectConfig = path.join(cwd, ".pi", "sandbox-guard.json");
    const globalConfig = path.join(home, ".pi", "agent", "sandbox-guard.json");
    await writeFile(
      projectConfig,
      JSON.stringify(rawConfig(cwd, { enforcement: { tools: ["read"], bypass: { mode: "deny" } } })),
      "utf-8",
    );
    await writeFile(
      globalConfig,
      JSON.stringify(rawConfig(cwd, { enforcement: { tools: ["bash"], bypass: { mode: "deny" } } })),
      "utf-8",
    );

    const result = await loadEffectiveConfig(cwd);

    expect(result).toMatchObject({ kind: "loaded" });
    if (result.kind !== "loaded") return;
    expect(result.config.sourcePath).toBe(projectConfig);
    expect(result.config.enforcement.tools).toEqual(["read"]);
  });

  it("falls back to global config when project config is absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-config-load-"));
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    mockHome.dir = home;

    await mkdir(cwd, { recursive: true });
    await mkdir(path.join(home, ".pi", "agent"), { recursive: true });
    const globalConfig = path.join(home, ".pi", "agent", "sandbox-guard.json");
    await writeFile(globalConfig, JSON.stringify(rawConfig(cwd)), "utf-8");

    const result = await loadEffectiveConfig(cwd);

    expect(result).toMatchObject({ kind: "loaded" });
    if (result.kind !== "loaded") return;
    expect(result.config.sourcePath).toBe(globalConfig);
  });

  it("disables the plugin when no config exists", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-config-load-"));
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    mockHome.dir = home;

    await mkdir(cwd, { recursive: true });
    await mkdir(home, { recursive: true });

    await expect(loadEffectiveConfig(cwd)).resolves.toMatchObject({
      kind: "disabled",
      reason: expect.stringContaining("no config found"),
    });
  });

  it("fails closed on an invalid project config instead of using global config", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "psg-config-load-"));
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    mockHome.dir = home;

    await mkdir(path.join(cwd, ".pi"), { recursive: true });
    await mkdir(path.join(home, ".pi", "agent"), { recursive: true });
    await writeFile(path.join(cwd, ".pi", "sandbox-guard.json"), "{", "utf-8");
    await writeFile(path.join(home, ".pi", "agent", "sandbox-guard.json"), JSON.stringify(rawConfig(cwd)), "utf-8");

    await expect(loadEffectiveConfig(cwd)).resolves.toMatchObject({ kind: "error" });
  });
});
