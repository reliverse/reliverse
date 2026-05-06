import type { Diagnostic } from "./types";

export class RelpackError extends Error {
  readonly diagnostic: Diagnostic;

  get code(): string {
    return this.diagnostic.code;
  }

  get hint(): string | undefined {
    return this.diagnostic.hint;
  }

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.name = "RelpackError";
    this.diagnostic = diagnostic;
  }
}

export function relpackError(code: string, message: string, hint?: string): RelpackError {
  return new RelpackError({
    severity: "error",
    code,
    message,
    ...(hint === undefined ? {} : { hint }),
  });
}

export function toDiagnostic(error: unknown): Diagnostic {
  if (error instanceof RelpackError) {
    return error.diagnostic;
  }

  if (error instanceof Error) {
    return { severity: "error", code: "unexpected-error", message: error.message };
  }

  return { severity: "error", code: "unexpected-error", message: String(error) };
}
