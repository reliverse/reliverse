export { runRelpackCli, type RelpackCliOptions } from "./direct-cli";
export { explainCommand } from "./core/explain";
export { detectArchiveFormat } from "./core/format";
export { DEFAULT_IGNORED_NAMES, buildIgnoredNames, parseIgnoredNameInput } from "./core/ignore";
export {
  RELPACK_MANIFEST_PATH,
  readManifestFromArchive,
  tryReadManifestFromArchive,
} from "./core/manifest";
export { diffArchiveWithOutput } from "./core/commands/diff";
export { listArchive } from "./core/commands/list";
export { packArchive } from "./core/commands/pack";
export { testArchive } from "./core/commands/test";
export { unpackArchive } from "./core/commands/unpack";
export { unpackArchiveBatch, deleteBatchSourceArchives } from "./core/commands/unpack-batch";
export { verifyArchive } from "./core/commands/verify";
export type {
  ArchiveEntry,
  ArchiveFormat,
  BatchOutputBackup,
  BatchUnpackItem,
  BatchUnpackItemResult,
  BatchUnpackRequest,
  BatchUnpackResult,
  CommandContext,
  Diagnostic,
  DiffRequest,
  DiffResult,
  ListRequest,
  PackRequest,
  PackResult,
  RelpackCommandName,
  RelpackJsonReport,
  RelpackManifest,
  TestRequest,
  UnpackRequest,
  UnpackResult,
  VerifyRequest,
  VerifyResult,
} from "./core/types";
