import type { NormalizedOptionIssue } from "../options/types";

export type ParserErrorKind = "usage" | "validation";

export interface ParserStructuredError {
  readonly code: string;
  readonly issues?: ReadonlyArray<NormalizedOptionIssue> | undefined;
  readonly kind: ParserErrorKind;
  readonly message: string;
  readonly ok: false;
  readonly parserError: 1;
  readonly schemaVersion: 1;
}

export class ParserError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly kind: ParserErrorKind;

  constructor(kind: ParserErrorKind, message: string, exitCode = 1) {
    super(message);
    this.name = "ParserError";
    this.code = `PARSER_${kind.toUpperCase()}`;
    this.exitCode = exitCode;
    this.kind = kind;
  }

  toStructuredError(): ParserStructuredError {
    return {
      code: this.code,
      kind: this.kind,
      message: this.message,
      ok: false,
      parserError: 1,
      schemaVersion: 1,
    };
  }
}

export class ParserUsageError extends ParserError {
  constructor(message: string, exitCode = 1) {
    super("usage", message, exitCode);
    this.name = "ParserUsageError";
  }
}

export class ParserValidationError extends ParserError {
  readonly issues: ReadonlyArray<NormalizedOptionIssue>;

  constructor(message: string, issues: ReadonlyArray<NormalizedOptionIssue>) {
    super("validation", message, 1);
    this.name = "ParserValidationError";
    this.issues = issues;
  }

  override toStructuredError(): ParserStructuredError {
    return {
      ...super.toStructuredError(),
      issues: this.issues,
    };
  }
}
