import type { RelicoInstance } from "@reliverse/relico";
import type { NormalizedOptionIssue } from "../options/types";

export type OutputMode = "json" | "text";

export type StdinMode = "pipe" | "tty";

export type ConfirmationMode = "disabled" | "prompt";

export type RemptsInteractionMode = "never" | "tty" | "tui";

export type RemptsHostInteractionMode = RemptsInteractionMode | "auto";

export type RemptsErrorKind = "internal" | "prompt" | "usage" | "validation";

export interface ParsedGlobalFlags {
  readonly help: boolean;
  readonly interactive: boolean;
  readonly json: boolean;
  readonly noInput: boolean;
  readonly tui: boolean;
}

export interface StructuredRemptsError {
  readonly code: string;
  readonly hint?: string | undefined;
  readonly issues?: ReadonlyArray<NormalizedOptionIssue> | undefined;
  readonly kind: RemptsErrorKind;
  readonly message: string;
  readonly ok: false;
  readonly relatedCommand?: string | undefined;
  readonly remptsError: 1;
  readonly schemaVersion: 1;
  readonly usage?: string | undefined;
}

export interface StructuredRemptsResult<TData = unknown> {
  readonly command?: string | undefined;
  readonly data: TData;
  readonly ok: true;
  readonly remptsResult: 1;
  readonly schemaVersion: 1;
}

export interface RuntimeOutput {
  readonly colors: {
    readonly stderr: RelicoInstance;
    readonly stdout: RelicoInstance;
  };
  readonly mode: OutputMode;
  data(value: unknown): void;
  problem(error: StructuredRemptsError): void;
  result<TData>(value: TData, command?: string | undefined): void;
  text(...values: readonly unknown[]): void;
  error(...values: readonly unknown[]): void;
}
