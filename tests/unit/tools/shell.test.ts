import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { shellCommandFromArgv } from "../../../src/tools/shell";

describe("shell command construction", () => {
  it("round-trips argv through the bash eval path used by sandboxed tools", () => {
    const argv = [
      "rg",
      "--glob",
      "!**/weird ' skip/*.txt",
      "needle ' ! value",
      "$(printf injected)",
      "semi;colon",
      "star*value",
      "/tmp/search root",
    ];

    expect(roundTripThroughBashEval(argv)).toEqual(argv);
  });

  it("preserves empty arguments and shell metacharacters as literal argv values", () => {
    const argv = ["printf", "%s", "", "$HOME", "`uname`", "a && b", "[abc]", "{one,two}"];

    expect(roundTripThroughBashEval(argv)).toEqual(argv);
  });
});

function roundTripThroughBashEval(argv: string[]): string[] {
  expect(spawnSync("bash", ["-c", "true"], { stdio: "ignore" }).status).toBe(0);

  const command = shellCommandFromArgv([
    process.execPath,
    "-e",
    "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
    "--",
    ...argv,
  ]);
  const result = spawnSync("bash", ["-c", "eval \"$PI_TEST_COMMAND\""], {
    env: { ...process.env, PI_TEST_COMMAND: command },
    encoding: "utf-8",
  });

  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as string[];
}
