import { describe, expect, it } from "vitest";
import { ConfigError } from "../../../src/errors";
import { parseGuardConfig } from "../../../src/config/schema";

const validConfig = {
  enabled: true,
  sandbox: {
    network: { allowedDomains: [], deniedDomains: [] },
    filesystem: { denyRead: [], allowWrite: ["."], denyWrite: [] },
  },
  enforcement: {
    tools: ["bash", "read", "write", "edit", "grep", "find", "ls"],
    bypass: { mode: "deny" },
  },
};

describe("guard config schema", () => {
  it("requires explicit sandbox and enforcement fields", () => {
    expect(() => parseGuardConfig({ enabled: true }, "config.json")).toThrow(ConfigError);
  });

  it("does not invent reviewer defaults for review bypass", () => {
    expect(() =>
      parseGuardConfig(
        {
          ...validConfig,
          enforcement: { tools: validConfig.enforcement.tools, bypass: { mode: "review" } },
        },
        "config.json",
      ),
    ).toThrow(/reviewer.enabled/);
  });

  it("rejects unsupported tools and bypass modes", () => {
    expect(() =>
      parseGuardConfig(
        {
          ...validConfig,
          enforcement: { tools: ["bash", "curl"], bypass: { mode: "deny" } },
        },
        "config.json",
      ),
    ).toThrow(/unsupported tool/);
    expect(() =>
      parseGuardConfig(
        {
          ...validConfig,
          enforcement: { tools: ["bash"], bypass: { mode: "allow" } },
        },
        "config.json",
      ),
    ).toThrow(/must be "review" or "deny"/);
  });

  it("requires explicit filesystem arrays", () => {
    expect(() =>
      parseGuardConfig(
        {
          ...validConfig,
          sandbox: {
            ...validConfig.sandbox,
            filesystem: { denyRead: [], denyWrite: [] },
          },
        },
        "config.json",
      ),
    ).toThrow(/allowWrite/);
  });

  it("accepts a fully explicit config", () => {
    expect(parseGuardConfig(validConfig, "config.json")).toMatchObject({
      enabled: true,
      enforcement: { bypass: { mode: "deny" } },
    });
  });
});
