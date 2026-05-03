import path from "node:path";

import { assertInputsExist, assertOutputArchiveCanBeWritten, ensureDirectory } from "../fs";
import { toArchiveInputPath } from "../path-safety";
import { canRun, runProcess } from "../spawn";
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

async function hasZipTools(ctx: CommandContext): Promise<boolean> {
  return (await canRun("zip", ctx)) && (await canRun("unzip", ctx));
}

function parseZipList(stdout: string): readonly ArchiveEntry[] {
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

export const zipAdapter: ArchiveAdapter = {
  id: "system-zip",
  formats: ["zip"],
  canPack: true,
  canUnpack: true,
  canList: true,
  canTest: true,

  async isAvailable(ctx) {
    return hasZipTools(ctx);
  },

  async pack(request: PackRequest, ctx: CommandContext): Promise<ProcessResult> {
    const output = path.resolve(request.cwd, request.output);
    const resolvedInputs = request.inputs.map((input) => path.resolve(request.cwd, input));
    await assertInputsExist(resolvedInputs);
    await assertOutputArchiveCanBeWritten(output, request.overwrite);
    const entries = request.inputs.map((input) => toArchiveInputPath(request.cwd, input));
    const args = ["-r", "-q", output, ...entries];
    if (request.dryRun) return { command: "zip", args, exitCode: 0, stdout: "", stderr: "" };
    return runProcess("zip", args, { cwd: ctx.cwd, env: ctx.env });
  },

  async list(request: ListRequest, ctx: CommandContext): Promise<readonly ArchiveEntry[]> {
    const archive = path.resolve(request.cwd, request.archive);
    const result = await runProcess("unzip", ["-Z1", archive], { cwd: ctx.cwd, env: ctx.env });
    if (result.exitCode !== 0)
      throw new Error(result.stderr || `unzip failed to list archive: ${archive}`);
    return parseZipList(result.stdout);
  },

  async unpack(request: UnpackRequest, ctx: CommandContext): Promise<ProcessResult> {
    const archive = path.resolve(request.cwd, request.archive);
    const outputDir = path.resolve(request.cwd, request.outputDir);
    await ensureDirectory(outputDir);
    const overwriteFlag = request.overwrite === "always" ? "-o" : "-n";
    const args = [overwriteFlag, "-q", archive, "-d", outputDir];
    if (request.dryRun) return { command: "unzip", args, exitCode: 0, stdout: "", stderr: "" };
    return runProcess("unzip", args, { cwd: ctx.cwd, env: ctx.env });
  },

  async test(request: TestRequest, ctx: CommandContext): Promise<ProcessResult> {
    const archive = path.resolve(request.cwd, request.archive);
    return runProcess("unzip", ["-t", archive], { cwd: ctx.cwd, env: ctx.env });
  },
};
