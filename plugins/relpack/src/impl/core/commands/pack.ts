import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { getAdapterForFormat } from "../adapters/registry";
import { relpackError } from "../error";
import { detectArchiveFormat, normalizeArchiveFormat } from "../format";
import { assertOutputArchiveCanBeWritten } from "../fs";
import {
  createManifestFromStagedEntries,
  RELPACK_MANIFEST_PATH,
  RELPACK_METADATA_DIR,
} from "../manifest";
import { assertSafeArchiveEntryPath, toArchiveInputPath } from "../path-safety";
import type {
  CommandContext,
  PackRequest,
  PackResult,
  PackSkippedEntry,
  RelpackManifest,
} from "../types";

interface PackPlan {
  readonly inputEntries: readonly string[];
  readonly skipped: readonly PackSkippedEntry[];
  readonly manifest?: RelpackManifest;
  readonly manifestPath?: string;
}

export async function packArchive(request: PackRequest, ctx: CommandContext): Promise<PackResult> {
  if (request.inputs.length === 0) {
    throw relpackError("missing-pack-inputs", "Pack command requires at least one input path.");
  }

  const format = normalizeArchiveFormat(request.format ?? detectArchiveFormat(request.output));
  const adapter = await getAdapterForFormat(format, ctx);

  if (!adapter.canPack || adapter.pack === undefined) {
    throw relpackError("pack-unsupported", `Packing is not supported for format: ${format}`);
  }

  const output = path.resolve(request.cwd, request.output);
  await assertOutputArchiveCanBeWritten(output, request.overwrite, {
    createParentDirectory: !request.dryRun,
  });

  if (request.dryRun) {
    const plan = await createDryRunPackPlan(request, output);
    const previewInputs = plan.inputEntries.length > 0 ? plan.inputEntries : request.inputs;
    const result = await adapter.pack(
      {
        ...request,
        cwd: request.cwd,
        inputs: previewInputs,
        output,
        format,
        dryRun: true,
        ignoredNames: [],
      },
      ctx,
    );
    return {
      ...result,
      skipped: plan.skipped,
      ...(plan.manifest === undefined ? {} : { manifest: plan.manifest }),
    };
  }

  const stageDir = await mkdtemp(path.join(tmpdir(), "relpack-pack-"));

  try {
    const plan = await stagePackInputs(request, output, stageDir);
    const stageInputs = [...plan.inputEntries];

    if (request.manifest !== false) {
      const manifest = await createManifestFromStagedEntries(
        stageDir,
        await collectStageEntries(stageDir),
      );
      await writeManifest(stageDir, manifest);
      stageInputs.push(RELPACK_MANIFEST_PATH);
      const result = await adapter.pack(
        {
          ...request,
          cwd: stageDir,
          inputs: stageInputs,
          output,
          format,
          dryRun: false,
          ignoredNames: [],
        },
        { cwd: stageDir, env: ctx.env },
      );
      if (result.exitCode !== 0) {
        throw relpackError(
          "pack-failed",
          result.stderr || `Pack backend failed with exit code ${result.exitCode}.`,
        );
      }
      return {
        ...result,
        skipped: plan.skipped,
        manifest,
        manifestPath: RELPACK_MANIFEST_PATH,
      };
    }

    const result = await adapter.pack(
      {
        ...request,
        cwd: stageDir,
        inputs: stageInputs,
        output,
        format,
        dryRun: false,
        ignoredNames: [],
      },
      { cwd: stageDir, env: ctx.env },
    );

    if (result.exitCode !== 0) {
      throw relpackError(
        "pack-failed",
        result.stderr || `Pack backend failed with exit code ${result.exitCode}.`,
      );
    }

    return { ...result, skipped: plan.skipped };
  } finally {
    await rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function createDryRunPackPlan(request: PackRequest, output: string): Promise<PackPlan> {
  const skipped: PackSkippedEntry[] = [];
  const inputEntries: string[] = [];

  for (const input of request.inputs) {
    const fullInput = path.resolve(request.cwd, input);
    await lstat(fullInput).catch(() => {
      throw relpackError("missing-input", `Input path does not exist: ${input}`);
    });

    const archiveInputPath = toArchiveInputPath(request.cwd, input);
    if (archiveInputPath === ".") {
      const children = await readdir(fullInput);
      for (const child of children) {
        const childPath = path.join(fullInput, child);
        const childArchivePath = assertSafeArchiveEntryPath(child);
        if (
          shouldSkipEntry(childArchivePath, childPath, output, request.ignoredNames ?? [], skipped)
        ) {
          continue;
        }
        inputEntries.push(childArchivePath);
      }
    } else if (
      !shouldSkipEntry(archiveInputPath, fullInput, output, request.ignoredNames ?? [], skipped)
    ) {
      inputEntries.push(archiveInputPath);
    }
  }

  return { inputEntries: uniqueSorted(inputEntries), skipped };
}

async function stagePackInputs(
  request: PackRequest,
  output: string,
  stageDir: string,
): Promise<PackPlan> {
  const skipped: PackSkippedEntry[] = [];
  const inputEntries: string[] = [];

  for (const input of request.inputs) {
    const fullInput = path.resolve(request.cwd, input);
    await lstat(fullInput).catch(() => {
      throw relpackError("missing-input", `Input path does not exist: ${input}`);
    });

    const archiveInputPath = toArchiveInputPath(request.cwd, input);
    if (archiveInputPath === ".") {
      const children = await readdir(fullInput);
      for (const child of children) {
        const childFullPath = path.join(fullInput, child);
        const childArchivePath = assertSafeArchiveEntryPath(child);
        if (
          await copyEntryToStage(
            childFullPath,
            childArchivePath,
            stageDir,
            output,
            request.ignoredNames ?? [],
            skipped,
          )
        ) {
          inputEntries.push(childArchivePath);
        }
      }
      continue;
    }

    if (
      await copyEntryToStage(
        fullInput,
        archiveInputPath,
        stageDir,
        output,
        request.ignoredNames ?? [],
        skipped,
      )
    ) {
      inputEntries.push(archiveInputPath);
    }
  }

  return { inputEntries: uniqueSorted(inputEntries), skipped };
}

async function copyEntryToStage(
  sourcePath: string,
  archivePath: string,
  stageDir: string,
  output: string,
  ignoredNames: readonly string[],
  skipped: PackSkippedEntry[],
): Promise<boolean> {
  if (shouldSkipEntry(archivePath, sourcePath, output, ignoredNames, skipped)) {
    return false;
  }

  const info = await lstat(sourcePath);
  const destination = path.join(stageDir, archivePath);

  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const children = await readdir(sourcePath);
    for (const child of children) {
      const childArchivePath = assertSafeArchiveEntryPath(`${archivePath}/${child}`);
      await copyEntryToStage(
        path.join(sourcePath, child),
        childArchivePath,
        stageDir,
        output,
        ignoredNames,
        skipped,
      );
    }
    return true;
  }

  await mkdir(path.dirname(destination), { recursive: true });

  if (info.isSymbolicLink()) {
    const target = await readlink(sourcePath);
    await symlink(target, destination);
    return true;
  }

  if (info.isFile()) {
    await copyFile(sourcePath, destination);
    return true;
  }

  return false;
}

function shouldSkipEntry(
  archivePath: string,
  sourcePath: string,
  output: string,
  ignoredNames: readonly string[],
  skipped: PackSkippedEntry[],
): boolean {
  const normalized = archivePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = normalized.split("/").filter(Boolean);

  if (segments[0] === RELPACK_METADATA_DIR) {
    skipped.push({ path: normalized, reason: "relpack-metadata" });
    return true;
  }

  if (path.resolve(sourcePath) === output) {
    skipped.push({ path: normalized, reason: "output-archive" });
    return true;
  }

  for (const segment of segments) {
    if (ignoredNames.includes(segment)) {
      skipped.push({ path: normalized, reason: "ignored-name", matchedName: segment });
      return true;
    }
  }

  return false;
}

async function collectStageEntries(stageDir: string): Promise<readonly string[]> {
  const entries: string[] = [];

  async function walk(currentDir: string, prefix: string): Promise<void> {
    const children = await readdir(currentDir, { withFileTypes: true });
    for (const child of children) {
      const entryPath = prefix.length > 0 ? `${prefix}/${child.name}` : child.name;
      if (entryPath === RELPACK_METADATA_DIR || entryPath.startsWith(`${RELPACK_METADATA_DIR}/`)) {
        continue;
      }
      entries.push(assertSafeArchiveEntryPath(entryPath));
      if (child.isDirectory()) {
        await walk(path.join(currentDir, child.name), entryPath);
      }
    }
  }

  await walk(stageDir, "");
  return entries.sort((a, b) => a.localeCompare(b));
}

async function writeManifest(stageDir: string, manifest: RelpackManifest): Promise<void> {
  const manifestPath = path.join(stageDir, RELPACK_MANIFEST_PATH);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
