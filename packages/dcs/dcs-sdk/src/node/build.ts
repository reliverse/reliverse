import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, parse, resolve } from "node:path";

import {
  createDcsDocumentSchema,
  serializeCanonicalJson,
  type ConfigContractBundle,
  type DcsConfigIrArtifact,
  type DcsGeneratedArtifact,
} from "@reliverse/dcs-contract";

import { buildDcsArtifacts, type DcsArtifactBuild } from "../build";

export interface DcsGeneratedArtifactsOptions {
  readonly bundle: ConfigContractBundle;
  /** Optional compiler artifact emitted by a trusted authoring build. */
  readonly irArtifact?: DcsConfigIrArtifact;
  readonly outputDirectory: string;
}

export type DcsGeneratedArtifactState = "current" | "missing" | "stale";

export interface DcsGeneratedArtifactStatus {
  readonly filename: string;
  readonly state: DcsGeneratedArtifactState;
}

export interface DcsGeneratedArtifactsCheckResult {
  readonly build: DcsArtifactBuild;
  readonly outputDirectory: string;
  readonly statuses: readonly DcsGeneratedArtifactStatus[];
  readonly upToDate: boolean;
}

export interface DcsGeneratedArtifactsWriteResult extends DcsGeneratedArtifactsCheckResult {
  readonly unchanged: readonly string[];
  readonly written: readonly string[];
}

/** Compares deterministic projections without mutating the output directory. */
export async function checkDcsGeneratedArtifacts(
  options: DcsGeneratedArtifactsOptions,
): Promise<DcsGeneratedArtifactsCheckResult> {
  const build = await buildDcsArtifacts(
    options.bundle,
    options.irArtifact === undefined ? {} : { emitIr: true, ir: options.irArtifact.ir },
  );
  const statuses = await Promise.all(
    build.artifacts.map(async (artifact) =>
      Object.freeze({
        filename: artifact.filename,
        state: await readArtifactState(options.outputDirectory, artifact),
      }),
    ),
  );
  const upToDate = statuses.every((status) => status.state === "current");

  return Object.freeze({
    build,
    outputDirectory: options.outputDirectory,
    statuses: Object.freeze(statuses),
    upToDate,
  });
}

/**
 * Writes only stale or missing generated files. Each file uses temp-file plus
 * rename, so a crash never exposes a partially written individual artifact.
 */
export async function writeDcsGeneratedArtifacts(
  options: DcsGeneratedArtifactsOptions,
): Promise<DcsGeneratedArtifactsWriteResult> {
  const checked = await checkDcsGeneratedArtifacts(options);
  const written: string[] = [];
  const unchanged: string[] = [];

  for (const artifact of checked.build.artifacts) {
    const status = checked.statuses.find((candidate) => candidate.filename === artifact.filename);
    if (status?.state === "current") {
      unchanged.push(artifact.filename);
      continue;
    }

    await atomicWriteUtf8(join(options.outputDirectory, artifact.filename), artifact.content);
    written.push(artifact.filename);
  }

  return Object.freeze({
    ...checked,
    statuses: Object.freeze(
      checked.build.artifacts.map((artifact) =>
        Object.freeze({
          filename: artifact.filename,
          state: "current" as const,
        }),
      ),
    ),
    unchanged: Object.freeze(unchanged),
    upToDate: true,
    written: Object.freeze(written),
  });
}

/** Explicit editor projection: read-only by default, never required for runtime resolution. */
export async function writeDcsSchemaProjection(options: {
  readonly bundle: ConfigContractBundle;
  readonly schemaPath: string;
  readonly apply?: boolean;
}) {
  const schema = { content: serializeCanonicalJson(createDcsDocumentSchema(options.bundle)) };
  const target = resolve(options.schemaPath);
  let current: string | undefined;
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
      throw Error("DCS_UNSAFE_SCHEMA_PROJECTION");
    current = await readFile(target, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  const state =
    current === undefined ? "missing" : current === schema.content ? "current" : "stale";
  if (options.apply && state !== "current") {
    let parent = parse(target).root;
    for (const segment of dirname(target)
      .slice(parent.length)
      .split(/[/\\\\]/)
      .filter(Boolean)) {
      parent = join(parent, segment);
      try {
        await mkdir(parent);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      if (!(await lstat(parent)).isDirectory()) throw Error("DCS_UNSAFE_SCHEMA_PARENT");
    }
    // Only generated schema bytes are replaced; no product document or authority is changed.
    await atomicWriteUtf8(target, schema.content);
  }
  return { path: target, state, written: !!options.apply && state !== "current" };
}

async function readArtifactState(
  outputDirectory: string,
  artifact: DcsGeneratedArtifact,
): Promise<DcsGeneratedArtifactState> {
  const path = join(outputDirectory, artifact.filename);
  try {
    return (await readFile(path, "utf8")) === artifact.content ? "current" : "stale";
  } catch (error) {
    if (isMissingFileError(error)) {
      return "missing";
    }
    throw error;
  }
}

async function atomicWriteUtf8(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
