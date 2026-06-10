import { join } from "shlex";

// Use shlex's POSIX single-quote style. shell-quote.quote can leave \! literal in bash double quotes,
// which breaks ripgrep globs such as --glob "!pattern" after the sandbox eval path.
export function shellCommandFromArgv(argv: readonly string[]): string {
  return join(argv);
}

export function commandExitNotice(commandName: string, exitCode: number | null): string {
  return exitCode === null ? `${commandName} was terminated` : `${commandName} exited with code ${exitCode}`;
}
