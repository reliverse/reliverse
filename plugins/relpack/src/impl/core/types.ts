export type RelpackCommandName = "doctor" | "pack" | "unpack" | "list" | "test" | "explain";

export type ArchiveFormat =
  | "tar"
  | "tar.gz"
  | "tgz"
  | "tar.zst"
  | "tzst"
  | "tar.xz"
  | "txz"
  | "tar.bz2"
  | "tbz2"
  | "zip"
  | "7z"
  | "unknown";

export type DiagnosticSeverity = "info" | "warning" | "error";
export type OutputMode = "pretty" | "json";
export type OverwritePolicy = "never" | "always";

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly hint?: string;
}

export interface CommandContext {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface ArchiveEntry {
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink" | "hardlink" | "unknown";
  readonly size?: number;
}

export interface PackRequest {
  readonly cwd: string;
  readonly inputs: readonly string[];
  readonly output: string;
  readonly format?: ArchiveFormat;
  readonly overwrite: OverwritePolicy;
  readonly dryRun: boolean;
}

export interface UnpackRequest {
  readonly cwd: string;
  readonly archive: string;
  readonly outputDir: string;
  readonly format?: ArchiveFormat;
  readonly overwrite: OverwritePolicy;
  readonly dryRun: boolean;
}

export interface ListRequest {
  readonly cwd: string;
  readonly archive: string;
  readonly format?: ArchiveFormat;
}

export interface TestRequest {
  readonly cwd: string;
  readonly archive: string;
  readonly format?: ArchiveFormat;
}

export interface RelpackJsonReport {
  readonly ok: boolean;
  readonly command: RelpackCommandName;
  readonly format?: ArchiveFormat;
  readonly diagnostics: readonly Diagnostic[];
  readonly entries?: readonly ArchiveEntry[];
  readonly executed?: readonly string[];
}

export interface ProcessResult {
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}
