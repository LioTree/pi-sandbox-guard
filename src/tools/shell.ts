export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function commandExitNotice(commandName: string, exitCode: number | null): string {
  return exitCode === null ? `${commandName} was terminated` : `${commandName} exited with code ${exitCode}`;
}
