export interface FileMapping {
  format: string;
  patterns: string[];
}

export type EscapeKind = "convert" | "unescape";

export type EscapeActionState = "blocked" | "noop" | "planned" | "written";

export interface EscapeAction {
  readonly action: EscapeActionState;
  readonly kind: EscapeKind;
  readonly inputPath: string;
  readonly outputPath: string;
  readonly reason?: string | undefined;
}

export interface EscapeRunOptions {
  inputPath: string;
  apply: boolean;
  overwrite: boolean;
  recursive: boolean;
  unescape: boolean;
  map?: string | undefined;
  concurrency?: number | undefined;
}

export interface EscapeFileResult {
  action: EscapeAction;
  message: string | null;
}

export interface EscapeSummary {
  actions: EscapeAction[];
  blocked: number;
  noop: number;
  planned: number;
  total: number;
  written: number;
}

export interface EscapeRunResult extends EscapeSummary {
  command: "escape";
  apply: boolean;
  preview: boolean;
  overwrite: boolean;
  kind: EscapeKind;
  inputPath: string;
  fileCount: number;
}
