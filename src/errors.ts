export class SandboxGuardError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigError extends SandboxGuardError {
  constructor(message: string, cause?: unknown) {
    super(message, "CONFIG_ERROR", cause);
  }
}

export class PolicyDeniedError extends SandboxGuardError {
  constructor(message: string, cause?: unknown) {
    super(message, "POLICY_DENIED", cause);
  }
}

export class ReviewDeniedError extends SandboxGuardError {
  constructor(message: string, cause?: unknown) {
    super(message, "REVIEW_DENIED", cause);
  }
}

export class SandboxExecError extends SandboxGuardError {
  constructor(message: string, cause?: unknown) {
    super(message, "SANDBOX_EXEC_ERROR", cause);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
