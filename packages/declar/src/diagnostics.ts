import type { DeclarDiagnostic, DeclarDiagnosticCode, DeclarDiagnosticSeverity } from "./types";

export function createDeclarDiagnostic(
  code: DeclarDiagnosticCode,
  message: string,
  path: readonly string[],
  severity: DeclarDiagnosticSeverity = "warning",
): DeclarDiagnostic {
  return {
    code,
    message,
    path,
    severity,
  };
}

export function createDeclarError(
  code: DeclarDiagnosticCode,
  message: string,
  path: readonly string[],
): DeclarDiagnostic {
  return createDeclarDiagnostic(code, message, path, "error");
}

export function createDeclarInfo(
  code: DeclarDiagnosticCode,
  message: string,
  path: readonly string[],
): DeclarDiagnostic {
  return createDeclarDiagnostic(code, message, path, "info");
}

export function createDeclarWarning(
  code: DeclarDiagnosticCode,
  message: string,
  path: readonly string[],
): DeclarDiagnostic {
  return createDeclarDiagnostic(code, message, path, "warning");
}

export function hasDeclarErrors(diagnostics: readonly DeclarDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
