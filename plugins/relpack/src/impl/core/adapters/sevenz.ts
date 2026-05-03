import path from "node:path";

import { assertInputsExist, assertOutputArchiveCanBeWritten, ensureDirectory } from "../fs";
import { toArchiveInputPath } from "../path-safety";
import { findExecutable, runProcess } from "../spawn";
import type {
  ArchiveEntry,
  CommandContext,
  ListRequest,
  PackRequest,
  ProcessResult,
  TestRequest,
  UnpackRequest,
} from "../types";
import type { ArchiveAdapter } from "./types";

const SEVENZ_COMMANDS = ["7zz", "7z", "7za"] as const;

async function get7z(ctx: CommandContext): Promise<string | undefined> {
  return findExecutable(SEVENZ_COMMANDS, ctx);
}

function parse7zList(stdout: string, archivePath: string): readonly ArchiveEntry[] {
  const archiveBase = path.basename(archivePath);
  const entries: ArchiveEntry[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    const match = /^Path = (.+)$/.exec(line.trim());
    if (!match) continue;
    const entryPath = match[1];
    if (!entryPath || entryPath === archivePath || entryPath === archiveBase) continue;
    entries.push({
      path: entryPath.replace(/\/$/, ""),
      kind: entryPath.endsWith("/") ? "directory" : "unknown",
    });
  }

  return entries;
}

export const sevenzAdapter: ArchiveAdapter = {
  id: "system-7z",
  formats: ["7z"],
  canPack: true,
  canUnpack: true,
  canList: true,
  canTest: true,

  async isAvailable(ctx) {
    return (await get7z(ctx)) !== undefined;
  },

  async pack(request: PackRequest, ctx: CommandContext): Promise<ProcessResult> {
    const command = await get7z(ctx);
    if (command === undefined)
      throw new Error("7z backend is unavailable. Install 7zz, 7z, or 7za.");
    const output = path.resolve(request.cwd, request.output);
    const resolvedInputs = request.inputs.map((input) => path.resolve(request.cwd, input));
    await assertInputsExist(resolvedInputs);
    await assertOutputArchiveCanBeWritten(output, request.overwrite);
    const entries = request.inputs.map((input) => toArchiveInputPath(request.cwd, input));
    const args = ["a", "-t7z", output, ...entries];
    if (request.dryRun) return { command, args, exitCode: 0, stdout: "", stderr: "" };
    return runProcess(command, args, { cwd: ctx.cwd, env: ctx.env });
  },

  async list(request: ListRequest, ctx: CommandContext): Promise<readonly ArchiveEntry[]> {
    const command = await get7z(ctx);
    if (command === undefined)
      throw new Error("7z backend is unavailable. Install 7zz, 7z, or 7za.");
    const archive = path.resolve(request.cwd, request.archive);
    const result = await runProcess(command, ["l", "-slt", archive], {
      cwd: ctx.cwd,
      env: ctx.env,
    });
    if (result.exitCode !== 0)
      throw new Error(result.stderr || `${command} failed to list archive: ${archive}`);
    return parse7zList(result.stdout, archive);
  },

  async unpack(request: UnpackRequest, ctx: CommandContext): Promise<ProcessResult> {
    const command = await get7z(ctx);
    if (command === undefined)
      throw new Error("7z backend is unavailable. Install 7zz, 7z, or 7za.");
    const archive = path.resolve(request.cwd, request.archive);
    const outputDir = path.resolve(request.cwd, request.outputDir);
    await ensureDirectory(outputDir);
    const overwriteMode = request.overwrite === "always" ? "-aoa" : "-aos";
    const args = ["x", archive, `-o${outputDir}`, overwriteMode, "-y"];
    if (request.dryRun) return { command, args, exitCode: 0, stdout: "", stderr: "" };
    return runProcess(command, args, { cwd: ctx.cwd, env: ctx.env });
  },

  async test(request: TestRequest, ctx: CommandContext): Promise<ProcessResult> {
    const command = await get7z(ctx);
    if (command === undefined)
      throw new Error("7z backend is unavailable. Install 7zz, 7z, or 7za.");
    const archive = path.resolve(request.cwd, request.archive);
    return runProcess(command, ["t", archive], { cwd: ctx.cwd, env: ctx.env });
  },
};
