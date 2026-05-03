import path from "node:path";

import { normalizeArchiveFormat } from "../format";
import { assertInputsExist, assertOutputArchiveCanBeWritten, ensureDirectory } from "../fs";
import { toArchiveInputPath } from "../path-safety";
import { canRun, runProcess } from "../spawn";
import type {
  ArchiveEntry,
  ArchiveFormat,
  CommandContext,
  ListRequest,
  PackRequest,
  ProcessResult,
  TestRequest,
  UnpackRequest,
} from "../types";
import type { ArchiveAdapter } from "./types";

const TAR_FORMATS: readonly ArchiveFormat[] = [
  "tar",
  "tar.gz",
  "tgz",
  "tar.zst",
  "tzst",
  "tar.xz",
  "txz",
  "tar.bz2",
  "tbz2",
];

function tarCreateArgs(format: ArchiveFormat, output: string): string[] {
  const normalized = normalizeArchiveFormat(format);
  if (normalized === "tar.gz") return ["-czf", output];
  if (normalized === "tar.xz") return ["-cJf", output];
  if (normalized === "tar.bz2") return ["-cjf", output];
  if (normalized === "tar.zst") return ["--zstd", "-cf", output];
  return ["-cf", output];
}

function parseTarList(stdout: string): readonly ArchiveEntry[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (entryPath): ArchiveEntry => ({
        path: entryPath.replace(/\/$/, ""),
        kind: entryPath.endsWith("/") ? "directory" : "unknown",
      }),
    );
}

export const tarAdapter: ArchiveAdapter = {
  id: "system-tar",
  formats: TAR_FORMATS,
  canPack: true,
  canUnpack: true,
  canList: true,
  canTest: true,

  async isAvailable(ctx) {
    return canRun("tar", ctx);
  },

  async pack(request: PackRequest, ctx: CommandContext): Promise<ProcessResult> {
    const output = path.resolve(request.cwd, request.output);
    const resolvedInputs = request.inputs.map((input) => path.resolve(request.cwd, input));
    await assertInputsExist(resolvedInputs);
    await assertOutputArchiveCanBeWritten(output, request.overwrite);
    const entries = request.inputs.map((input) => toArchiveInputPath(request.cwd, input));
    const format = request.format ?? "tar";
    const args = [...tarCreateArgs(format, output), ...entries];
    if (request.dryRun) return { command: "tar", args, exitCode: 0, stdout: "", stderr: "" };
    return runProcess("tar", args, { cwd: ctx.cwd, env: ctx.env });
  },

  async list(request: ListRequest, ctx: CommandContext): Promise<readonly ArchiveEntry[]> {
    const archive = path.resolve(request.cwd, request.archive);
    const result = await runProcess("tar", ["-tf", archive], { cwd: ctx.cwd, env: ctx.env });
    if (result.exitCode !== 0)
      throw new Error(result.stderr || `tar failed to list archive: ${archive}`);
    return parseTarList(result.stdout);
  },

  async unpack(request: UnpackRequest, ctx: CommandContext): Promise<ProcessResult> {
    const archive = path.resolve(request.cwd, request.archive);
    const outputDir = path.resolve(request.cwd, request.outputDir);
    await ensureDirectory(outputDir);
    const args = ["-xf", archive, "-C", outputDir];
    if (request.dryRun) return { command: "tar", args, exitCode: 0, stdout: "", stderr: "" };
    return runProcess("tar", args, { cwd: ctx.cwd, env: ctx.env });
  },

  async test(request: TestRequest, ctx: CommandContext): Promise<ProcessResult> {
    const archive = path.resolve(request.cwd, request.archive);
    return runProcess("tar", ["-tf", archive], { cwd: ctx.cwd, env: ctx.env });
  },
};
