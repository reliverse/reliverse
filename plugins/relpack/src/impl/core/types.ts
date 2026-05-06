export type RelpackCommandName =
  | "doctor"
  | "pack"
  | "unpack"
  | "list"
  | "test"
  | "verify"
  | "diff"
  | "explain";

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
export type OverwritePolicy = "never" | "files";
export type UnpackOverwriteMode = "never" | "files" | "clean";
export type ArchiveEntryKind = "file" | "directory" | "symlink" | "hardlink" | "unknown";

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
  readonly kind: ArchiveEntryKind;
  readonly size?: number;
}

export interface RelpackManifestEntry {
  readonly path: string;
  readonly kind: ArchiveEntryKind;
  readonly size?: number;
  readonly sha256?: string;
}

export interface RelpackManifest {
  readonly schemaVersion: 1;
  readonly createdBy: "relpack";
  readonly createdAt: string;
  readonly packageName?: string;
  readonly version?: string;
  readonly entries: readonly RelpackManifestEntry[];
}

export interface PackSkippedEntry {
  readonly path: string;
  readonly reason: "ignored-name" | "output-archive" | "relpack-metadata";
  readonly matchedName?: string;
}

export interface PackRequest {
  readonly cwd: string;
  readonly inputs: readonly string[];
  readonly output: string;
  readonly format?: ArchiveFormat | undefined;
  readonly overwrite: OverwritePolicy;
  readonly dryRun: boolean;
  readonly ignoredNames?: readonly string[] | undefined;
  readonly manifest?: boolean;
}

export interface PackResult extends ProcessResult {
  readonly skipped: readonly PackSkippedEntry[];
  readonly manifest?: RelpackManifest | undefined;
  readonly manifestPath?: string | undefined;
}

export interface UnpackRequest {
  readonly cwd: string;
  readonly archive: string;
  readonly outputDir: string;
  readonly format?: ArchiveFormat | undefined;
  readonly overwrite: OverwritePolicy;
  readonly dryRun: boolean;
  readonly cleanOutput?: boolean | undefined;
  readonly backup?: boolean | undefined;
  readonly rollbackOnFail?: boolean | undefined;
  readonly postCheckCommand?: string | undefined;
}

export interface UnpackResult extends ProcessResult {
  readonly backupPath?: string | undefined;
  readonly backupCreated: boolean;
  readonly backupSkippedReason?: string | undefined;
  readonly rolledBack: boolean;
  readonly postCheck?: PostCheckResult | undefined;
}

export interface BatchUnpackItem {
  readonly archive: string;
  readonly outputDir: string;
  readonly format?: ArchiveFormat | undefined;
}

export interface BatchUnpackRequest {
  readonly cwd: string;
  readonly items: readonly BatchUnpackItem[];
  readonly overwrite: OverwritePolicy;
  readonly dryRun: boolean;
  readonly cleanOutput?: boolean | undefined;
  readonly backup?: boolean | undefined;
  readonly rollbackOnFail?: boolean | undefined;
  readonly postCheckCommand?: string | undefined;
}

export interface BatchUnpackItemResult {
  readonly archive: string;
  readonly outputDir: string;
  readonly format: ArchiveFormat;
  readonly result: ProcessResult;
}

export interface BatchOutputBackup {
  readonly outputDir: string;
  readonly backupPath?: string | undefined;
  readonly skippedReason?: string | undefined;
}

export interface BatchUnpackResult {
  readonly items: readonly BatchUnpackItemResult[];
  readonly backups: readonly BatchOutputBackup[];
  readonly backupCreated: boolean;
  readonly rolledBack: boolean;
  readonly postCheck?: PostCheckResult | undefined;
}

export interface PostCheckResult extends ProcessResult {
  readonly ok: boolean;
}

export interface ListRequest {
  readonly cwd: string;
  readonly archive: string;
  readonly format?: ArchiveFormat | undefined;
}

export interface TestRequest {
  readonly cwd: string;
  readonly archive: string;
  readonly format?: ArchiveFormat | undefined;
}

export interface VerifyRequest {
  readonly cwd: string;
  readonly archive: string;
  readonly format?: ArchiveFormat | undefined;
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly archive: string;
  readonly format: ArchiveFormat;
  readonly manifest: RelpackManifest;
  readonly checkedEntries: number;
  readonly mismatches: readonly VerifyMismatch[];
}

export interface VerifyMismatch {
  readonly path: string;
  readonly reason: "missing-entry" | "size-mismatch" | "sha256-mismatch" | "kind-mismatch";
  readonly expected?: string | number;
  readonly actual?: string | number;
}

export interface DiffRequest {
  readonly cwd: string;
  readonly archive: string;
  readonly outputDir: string;
  readonly format?: ArchiveFormat | undefined;
  readonly ignoredNames?: readonly string[] | undefined;
}

export interface DiffResult {
  readonly archive: string;
  readonly outputDir: string;
  readonly format: ArchiveFormat;
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly unchanged: readonly string[];
  readonly removed: readonly string[];
  readonly manifest?: RelpackManifest | undefined;
}

export interface RelpackJsonReport {
  readonly ok: boolean;
  readonly command: RelpackCommandName;
  readonly format?: ArchiveFormat | undefined;
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
