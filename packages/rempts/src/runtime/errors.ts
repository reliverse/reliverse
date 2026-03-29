import type { NormalizedOptionIssue } from "../options/types";
import type { RemptsErrorKind, StructuredRemptsError } from "./types";

export class RemptsExitSignal extends Error {
  readonly exitCode: number;
  readonly messageText?: string | undefined;

  constructor(exitCode: number, messageText?: string | undefined) {
    super("Rempts exit");
    this.name = "RemptsExitSignal";
    this.exitCode = exitCode;
    this.messageText = messageText;
  }
}

export interface RemptsErrorMetadata {
  readonly code?: string | undefined;
  readonly hint?: string | undefined;
  readonly relatedCommand?: string | undefined;
  readonly usage?: string | undefined;
}

export class RemptsError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly hint?: string | undefined;
  readonly kind: RemptsErrorKind;
  readonly relatedCommand?: string | undefined;
  readonly usage?: string | undefined;

  constructor(
    kind: RemptsErrorKind,
    message: string,
    exitCode = 1,
    metadata?: RemptsErrorMetadata | undefined,
  ) {
    super(message);
    this.name = "RemptsError";
    this.code = metadata?.code ?? `REMPTS_${kind.toUpperCase()}`;
    this.exitCode = exitCode;
    this.hint = metadata?.hint;
    this.kind = kind;
    this.relatedCommand = metadata?.relatedCommand;
    this.usage = metadata?.usage;
  }

  toStructuredError(): StructuredRemptsError {
    return {
      code: this.code,
      hint: this.hint,
      kind: this.kind,
      message: this.message,
      ok: false,
      relatedCommand: this.relatedCommand,
      remptsError: 1,
      schemaVersion: 1,
      usage: this.usage,
    };
  }
}

export class RemptsUsageError extends RemptsError {
  constructor(
    message: string,
    exitCode = 1,
    metadata?: RemptsErrorMetadata | undefined,
  ) {
    super("usage", message, exitCode, metadata);
    this.name = "RemptsUsageError";
  }
}

export class RemptsValidationError extends RemptsError {
  readonly issues: ReadonlyArray<NormalizedOptionIssue>;

  constructor(
    message: string,
    issues: ReadonlyArray<NormalizedOptionIssue>,
    metadata?: RemptsErrorMetadata | undefined,
  ) {
    super("validation", message, 1, metadata);
    this.name = "RemptsValidationError";
    this.issues = issues;
  }

  override toStructuredError(): StructuredRemptsError {
    return {
      ...super.toStructuredError(),
      issues: this.issues,
    };
  }
}

export class PromptUnavailableError extends RemptsError {
  constructor(message: string, metadata?: RemptsErrorMetadata | undefined) {
    super("prompt", message, 1, metadata);
    this.name = "PromptUnavailableError";
  }
}

export function toStructuredRemptsError(error: unknown): StructuredRemptsError {
  if (error instanceof RemptsValidationError) {
    return error.toStructuredError();
  }

  if (error instanceof RemptsError) {
    return error.toStructuredError();
  }

  if (error instanceof Error) {
    return {
      code: "REMPTS_INTERNAL",
      kind: "internal",
      message: error.message,
      ok: false,
      remptsError: 1,
      schemaVersion: 1,
    };
  }

  return {
    code: "REMPTS_INTERNAL",
    kind: "internal",
    message: "Unexpected Rempts runtime error.",
    ok: false,
    remptsError: 1,
    schemaVersion: 1,
  };
}
