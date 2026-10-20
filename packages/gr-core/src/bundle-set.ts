import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { publishGrArtifactAtomically } from "./atomic-publication";
import { GrError } from "./error";
import {
  readGrRepositoryBundleReceipt,
  verifyGrRepositoryBundleArtifact,
  type GrRepositoryBundleReceiptV0,
} from "./repository-bundle";

export const GR_BUNDLE_SET_SCHEMA_VERSION = "gr.bundle-set.v0" as const;

export interface GrBundleSetMemberInput {
  readonly id: string;
  readonly role: "repository" | "coordination";
  readonly archive: string;
  readonly receipt: string;
  readonly installer: string;
}

export interface GrBundleSetManifestV0 {
  readonly schemaVersion: typeof GR_BUNDLE_SET_SCHEMA_VERSION;
  readonly operation: "gr.bundle-set.create";
  readonly kind: "global-handoff";
  readonly handoff: {
    readonly id: string;
    readonly activeStageId: string;
    readonly activeStageOrder: number;
  };
  readonly members: readonly {
    readonly id: string;
    readonly role: "repository" | "coordination";
    readonly bundleId: string;
    readonly archive: string;
    readonly receipt: string;
    readonly installer: string;
    readonly sha256: string;
  }[];
  readonly sharedFiles: readonly {
    readonly path: string;
    readonly sha256: string;
    readonly size: number;
  }[];
}

export interface CreateGrBundleSetRequest {
  readonly output: string;
  readonly handoff: GrBundleSetManifestV0["handoff"];
  readonly members: readonly GrBundleSetMemberInput[];
  readonly signal?: AbortSignal;
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function run(argv: readonly string[], cwd: string, signal?: AbortSignal): Promise<string> {
  const child = Bun.spawn([...argv], {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    ...(signal ? { signal } : {}),
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    Bun.readableStreamToText(child.stdout),
    Bun.readableStreamToText(child.stderr),
  ]);
  if (code !== 0) {
    throw new GrError("GR_INVALID_ARTIFACT", `${argv[0]} failed while processing GR bundle set.`, {
      argv,
      stderr: stderr.trim(),
    });
  }
  return stdout;
}

function safeName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  if (!normalized)
    throw new GrError("GR_INVALID_ARTIFACT", "GR bundle-set member ID must not be empty.");
  return normalized;
}

async function copySharedTooling(
  receipt: GrRepositoryBundleReceiptV0,
  sourceDirectory: string,
  targetDirectory: string,
  shared: Map<string, { path: string; sha256: string; size: number }>,
): Promise<void> {
  for (const attachment of receipt.manifest.tooling.attachments) {
    if (attachment.delivery !== "sidecar" || !attachment.sidecar) continue;
    const fileName = path.basename(attachment.sidecar.fileName);
    const source = path.join(sourceDirectory, fileName);
    if (!(await Bun.file(source).exists())) {
      if (attachment.required) {
        throw new GrError(
          "GR_INVALID_ARTIFACT",
          "Required GR bundle-set tooling sidecar is missing.",
          {
            memberBundleId: receipt.bundleId,
            fileName,
          },
        );
      }
      continue;
    }
    const bytes = new Uint8Array(await Bun.file(source).arrayBuffer());
    const digest = sha256(bytes);
    if (digest !== attachment.sidecar.sha256) {
      throw new GrError("GR_INVALID_ARTIFACT", "GR bundle-set tooling sidecar digest mismatch.", {
        fileName,
        expected: attachment.sidecar.sha256,
        actual: digest,
      });
    }
    const existing = shared.get(fileName);
    if (existing && existing.sha256 !== digest) {
      throw new GrError("GR_INVALID_ARTIFACT", "GR bundle-set shared filename collision.", {
        fileName,
      });
    }
    if (!existing) {
      const target = path.join(targetDirectory, fileName);
      await copyFile(source, target);
      shared.set(fileName, {
        path: `members/${fileName}`,
        sha256: digest,
        size: (await stat(target)).size,
      });
    }
  }
}

async function checksumRows(root: string): Promise<string[]> {
  const rows: string[] = [];
  const glob = new Bun.Glob("**/*");
  for await (const relative of glob.scan({
    cwd: root,
    dot: true,
    onlyFiles: true,
    followSymlinks: false,
  })) {
    if (relative === "checksums.sha256") continue;
    const bytes = new Uint8Array(await Bun.file(path.join(root, relative)).arrayBuffer());
    rows.push(`${sha256(bytes).slice(7)}  ${relative.replaceAll("\\", "/")}`);
  }
  return rows.sort();
}

export async function createGrBundleSet(request: CreateGrBundleSetRequest) {
  if (request.members.length < 2) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "A Global Handoff GR bundle set requires at least two repository members.",
    );
  }
  const output = path.resolve(request.output);
  if (!output.endsWith(".tar.zst")) {
    throw new GrError("GR_INVALID_ARTIFACT", "GR bundle-set output must end with .tar.zst.", {
      output,
    });
  }
  if (await Bun.file(output).exists()) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR bundle-set output already exists; refusing to overwrite.",
      { output },
    );
  }

  const staging = await mkdtemp(path.join(tmpdir(), "reliverse-gr-bundle-set-"));
  try {
    const membersDir = path.join(staging, "members");
    await mkdir(membersDir, { recursive: true });
    const manifestMembers: GrBundleSetManifestV0["members"][number][] = [];
    const shared = new Map<string, { path: string; sha256: string; size: number }>();
    const ids = new Set<string>();

    for (const input of request.members) {
      const id = safeName(input.id);
      if (ids.has(id))
        throw new GrError("GR_INVALID_ARTIFACT", `Duplicate GR bundle-set member ID: ${id}`);
      ids.add(id);
      const receipt = await readGrRepositoryBundleReceipt(input.receipt);
      const archiveBytes = new Uint8Array(await Bun.file(input.archive).arrayBuffer());
      const archiveDigest = sha256(archiveBytes);
      if (archiveDigest !== receipt.archive.sha256) {
        throw new GrError("GR_INVALID_ARTIFACT", "GR bundle-set member archive digest mismatch.", {
          id,
          expected: receipt.archive.sha256,
          actual: archiveDigest,
        });
      }

      const archiveName = path.basename(input.archive);
      const receiptName = path.basename(input.receipt);
      const installerName = path.basename(input.installer);
      for (const [source, name] of [
        [input.archive, archiveName],
        [input.receipt, receiptName],
        [input.installer, installerName],
      ] as const) {
        await copyFile(source, path.join(membersDir, name));
      }
      await copySharedTooling(receipt, path.dirname(input.archive), membersDir, shared);
      manifestMembers.push({
        id,
        role: input.role,
        bundleId: receipt.bundleId,
        archive: `members/${archiveName}`,
        receipt: `members/${receiptName}`,
        installer: `members/${installerName}`,
        sha256: archiveDigest,
      });
    }

    const manifest: GrBundleSetManifestV0 = {
      schemaVersion: GR_BUNDLE_SET_SCHEMA_VERSION,
      operation: "gr.bundle-set.create",
      kind: "global-handoff",
      handoff: request.handoff,
      members: manifestMembers,
      sharedFiles: [...shared.values()].sort((a, b) => a.path.localeCompare(b.path)),
    };
    await writeFile(
      path.join(staging, "bundle-set.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await writeFile(
      path.join(staging, "checksums.sha256"),
      `${(await checksumRows(staging)).join("\n")}\n`,
    );
    const publication = await publishGrArtifactAtomically({
      output,
      writeTemporary: async (temporaryOutput) => {
        await run(
          [
            "tar",
            "--sort=name",
            "--mtime=1970-01-01T00:00:00Z",
            "--owner=0",
            "--group=0",
            "--numeric-owner",
            "--zstd",
            "-cf",
            temporaryOutput,
            "-C",
            staging,
            ".",
          ],
          staging,
          request.signal,
        );

        const bytes = new Uint8Array(await Bun.file(temporaryOutput).arrayBuffer());
        return {
          sha256: sha256(bytes),
          size: (await stat(temporaryOutput)).size,
        };
      },
    });

    return Object.freeze({
      kind: "global-handoff" as const,
      archive: {
        path: publication.output,
        sha256: publication.value.sha256,
        size: publication.value.size,
      },
      manifest,
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function verifyGrBundleSetArtifact(options: {
  readonly archive: string;
  readonly signal?: AbortSignal;
}) {
  const archive = path.resolve(options.archive);
  const diagnostics: string[] = [];
  const staging = await mkdtemp(path.join(tmpdir(), "reliverse-gr-bundle-set-verify-"));
  try {
    const list = await run(["tar", "--zstd", "-tf", archive], staging, options.signal);
    const entries = list.split("\n").filter(Boolean);
    if (!entries.some((entry) => entry.replace(/^\.\//u, "") === "bundle-set.json")) {
      return { recognized: false as const, ok: false as const, diagnostics: ["not-a-bundle-set"] };
    }
    for (const entry of entries) {
      const clean = entry.replace(/^\.\//u, "");
      if (
        clean.startsWith("/") ||
        clean === ".." ||
        clean.startsWith("../") ||
        clean.includes("/../")
      ) {
        diagnostics.push(`outer-unsafe-path:${entry}`);
      }
    }
    if (diagnostics.length > 0)
      return { recognized: true as const, ok: false as const, diagnostics };
    await run(["tar", "--zstd", "-xf", archive, "-C", staging], staging, options.signal);
    try {
      await run(["sha256sum", "-c", "checksums.sha256"], staging, options.signal);
    } catch (error) {
      diagnostics.push(
        `payload-checksum-mismatch:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const manifest = JSON.parse(
      await readFile(path.join(staging, "bundle-set.json"), "utf8"),
    ) as GrBundleSetManifestV0;
    if (
      manifest.schemaVersion !== GR_BUNDLE_SET_SCHEMA_VERSION ||
      manifest.operation !== "gr.bundle-set.create"
    ) {
      diagnostics.push("manifest-schema-invalid");
    }
    for (const member of manifest.members ?? []) {
      const archivePath = path.join(staging, ...member.archive.split("/"));
      const receiptPath = path.join(staging, ...member.receipt.split("/"));
      const verification = await verifyGrRepositoryBundleArtifact({
        archive: archivePath,
        receipt: receiptPath,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (!verification.ok)
        diagnostics.push(...verification.diagnostics.map((item) => `member:${member.id}:${item}`));
    }
    return { recognized: true as const, ok: diagnostics.length === 0, diagnostics, manifest };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
