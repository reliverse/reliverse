import { createHash } from "node:crypto";
import { cp, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  digestRprDirectoryTree,
  verifyRprToolchainMaterialization,
} from "@reliverse/rpr-toolchain-materialization";

import { createGrPrivateContinuation, type GrPrivateContinuationV0 } from "./bundle-continuation";
import {
  resolveGrBundlePolicy,
  grBundlePathExcluded,
  type GrBundlePolicyV0,
} from "./bundle-policy";
import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { runRequiredGrGit } from "./git";
import type { GrEffectKind, GrSnapshot } from "./model";
import { parseGrSnapshot } from "./snapshot";

export const GR_REPOSITORY_BUNDLE_SCHEMA_VERSION = "gr.repository-bundle.v0" as const;
export const GR_REPOSITORY_BUNDLE_RECEIPT_SCHEMA_VERSION =
  "gr.repository-bundle-receipt.v0" as const;

export type GrBundleProfile = "source" | "handoff" | "offline";
export type GrBundleToolingDelivery = "embedded" | "sidecar";

export interface GrRprToolchainAttachment {
  readonly root: string;
  readonly role?: string;
  readonly delivery?: GrBundleToolingDelivery;
  readonly required?: boolean;
  readonly compositionId?: string;
  readonly lockId?: string;
  readonly execution?: {
    readonly lockfile: { readonly path: string; readonly sha256: string };
    readonly workspaceLinks: readonly {
      readonly packageName: string;
      readonly repositoryPath: string;
    }[];
    readonly dependencyLinks: readonly {
      readonly repositoryPath: string;
      readonly packageName: string;
      readonly materializedPath: string;
    }[];
  };
}

export interface GrRepositoryBundleToolingAttachmentV0 {
  readonly id: string;
  readonly kind: "rpr-toolchain-materialization";
  readonly role: string;
  readonly delivery: GrBundleToolingDelivery;
  readonly required: boolean;
  readonly compositionId: string;
  readonly lockId: string;
  readonly materializationDigest: string;
  readonly path?: string;
  readonly sidecar?: {
    readonly fileName: string;
    readonly sha256: string;
    readonly size: number;
  };
  readonly execution?: {
    readonly lockfile: { readonly path: string; readonly sha256: string };
    readonly workspaceLinks: readonly {
      readonly packageName: string;
      readonly repositoryPath: string;
    }[];
    readonly dependencyLinks: readonly {
      readonly repositoryPath: string;
      readonly packageName: string;
      readonly materializedPath: string;
    }[];
  };
}

export interface GrRepositoryBundleManifestV0 {
  readonly schemaVersion: typeof GR_REPOSITORY_BUNDLE_SCHEMA_VERSION;
  readonly operation: "gr.repository.bundle.create";
  readonly profile: GrBundleProfile;
  readonly bundleId: string;
  readonly repository: GrSnapshot["repository"];
  readonly snapshot: {
    readonly id: string;
    readonly fingerprint: string;
    readonly tree: GrSnapshot["worktreeTree"];
  };
  readonly selection:
    | { readonly kind: "workspace" }
    | { readonly kind: "paths"; readonly paths: readonly string[] };
  readonly source: { readonly path: string; readonly sha256: string; readonly entries: number };
  readonly policy: GrBundlePolicyV0;
  readonly history:
    | { readonly mode: "none" }
    | {
        readonly mode: "refs" | "commits";
        readonly path: string;
        readonly sha256: string;
        readonly entries: number;
      };
  readonly repositoryState:
    | { readonly kind: "none" }
    | { readonly kind: "git-projection"; readonly path: string; readonly sha256: string };
  readonly handoff: { readonly entries: readonly string[] };
  readonly continuation: GrPrivateContinuationV0;
  readonly tooling: { readonly attachments: readonly GrRepositoryBundleToolingAttachmentV0[] };
}
export interface GrRepositoryBundleReceiptV0 {
  readonly schemaVersion: typeof GR_REPOSITORY_BUNDLE_RECEIPT_SCHEMA_VERSION;
  readonly operation: "gr.repository.bundle.create";
  readonly profile: GrBundleProfile;
  readonly bundleId: string;
  readonly archive: { readonly path: string; readonly sha256: string; readonly size: number };
  readonly manifest: GrRepositoryBundleManifestV0;
}

export interface GrRepositoryBundleRequest {
  readonly root: string;
  readonly snapshot: GrSnapshot;
  readonly paths?: readonly string[];
  readonly profile?: GrBundleProfile;
  readonly tooling?: GrRprToolchainAttachment | readonly GrRprToolchainAttachment[];
  readonly output?: string;
  readonly grantedEffects?: readonly GrEffectKind[];
  readonly signal?: AbortSignal;
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function run(root: string, argv: readonly string[], signal?: AbortSignal): Promise<string> {
  const child = Bun.spawn([...argv], {
    cwd: root,
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
  if (code !== 0)
    throw new GrError("GR_GIT_FAILED", `${argv[0]} failed while creating repository bundle.`, {
      argv,
      stderr: stderr.trim(),
    });
  return stdout;
}

async function readToolchainReceipt(tooling: GrRprToolchainAttachment) {
  const root = path.resolve(tooling.root);
  const receiptPath = path.join(root, "receipt.json");
  let value: any;
  try {
    value = JSON.parse(await readFile(receiptPath, "utf8"));
  } catch {
    throw new GrError("GR_INVALID_ARTIFACT", "RPR toolchain attachment is missing receipt.json.", {
      root,
    });
  }
  if (
    value?.schema !== "reliverse.rpr.toolchain-materialization-receipt.v0" ||
    value?.network !== "denied"
  )
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR only accepts an RPR v0 offline toolchain materialization receipt.",
      { root },
    );
  const verified = await verifyRprToolchainMaterialization(root);
  if (!verified.ok)
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "RPR toolchain materialization failed domain-owned verification.",
      { root, diagnostics: verified.diagnostics },
    );
  if (tooling.compositionId && value.compositionId !== tooling.compositionId)
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "RPR toolchain composition ID does not match requested attachment.",
    );
  if (tooling.lockId && value.lockId !== tooling.lockId)
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "RPR toolchain lock ID does not match requested attachment.",
    );
  return { root, receiptPath, receipt: value };
}

function bundleSlug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/gu, "-")
      .replaceAll(/^-+|-+$/gu, "") || "repository"
  );
}

async function resolveBundleOutput(
  root: string,
  snapshot: GrSnapshot,
  selectedPaths: readonly string[],
  requested: string | undefined,
): Promise<string> {
  const labelParts = [bundleSlug(path.basename(root))];
  if (selectedPaths.length === 1) labelParts.push(bundleSlug(path.basename(selectedPaths[0]!)));
  const fileName = `${labelParts.join("-")}-${snapshot.snapshotId.replace(/^gr-snapshot-/u, "").slice(0, 12)}.tar.zst`;
  if (!requested) {
    const now = new Date();
    const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}-${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}`;
    const base = path.join(root, ".private", "reliverse", "gr", "bundles");
    for (let capture = 0; capture < 1000; capture += 1) {
      const directory = path.join(
        base,
        capture === 0 ? stamp : `${stamp}-${String(capture).padStart(2, "0")}`,
      );
      const candidate = path.join(directory, fileName);
      const stem = candidate.slice(0, -".tar.zst".length);
      if (
        !(await Bun.file(candidate).exists()) &&
        !(await Bun.file(`${stem}.receipt.json`).exists())
      )
        return candidate;
    }
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR bundle capture allocation exhausted for the current timestamp.",
      { base, stamp },
    );
  }
  const resolved = path.resolve(requested);
  return requested.endsWith(".tar.zst") ? resolved : path.join(resolved, fileName);
}

function normalizeToolingInputs(
  tooling: GrRepositoryBundleRequest["tooling"],
): readonly GrRprToolchainAttachment[] {
  if (!tooling) return [];
  return Array.isArray(tooling) ? tooling : [tooling as GrRprToolchainAttachment];
}

async function createDeterministicDirectoryArchive(
  root: string,
  output: string,
  signal?: AbortSignal,
): Promise<{ readonly sha256: string; readonly size: number }> {
  await run(
    root,
    [
      "tar",
      "--sort=name",
      "--mtime=1970-01-01T00:00:00Z",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "--zstd",
      "-cf",
      output,
      "-C",
      root,
      ".",
    ],
    signal,
  );
  const bytes = new Uint8Array(await Bun.file(output).arrayBuffer());
  return { sha256: sha256(bytes), size: (await stat(output)).size };
}

async function prepareToolingAttachments(
  request: GrRepositoryBundleRequest,
  staging: string,
  output: string,
): Promise<{
  readonly manifest: readonly GrRepositoryBundleToolingAttachmentV0[];
  readonly sidecars: readonly {
    readonly stagedPath: string;
    readonly finalPath: string;
    readonly sha256: string;
  }[];
}> {
  const attachments: GrRepositoryBundleToolingAttachmentV0[] = [];
  const sidecars: { stagedPath: string; finalPath: string; sha256: string }[] = [];
  const seenRoles = new Set<string>();
  for (const [index, input] of normalizeToolingInputs(request.tooling).entries()) {
    const tooling = await readToolchainReceipt(input);
    const role = input.role?.trim() || (index === 0 ? "operator" : `tooling-${index + 1}`);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(role)) {
      throw new GrError("GR_INVALID_ARTIFACT", `Invalid GR tooling attachment role: ${role}`);
    }
    if (seenRoles.has(role))
      throw new GrError("GR_INVALID_ARTIFACT", `Duplicate GR tooling attachment role: ${role}`);
    seenRoles.add(role);
    const delivery = input.delivery ?? "embedded";
    const required = input.required ?? true;
    const materializationDigest = await digestRprDirectoryTree(tooling.root);
    const id = `rpr-toolchain-${materializationDigest.slice(7, 19)}`;
    const base = {
      id,
      kind: "rpr-toolchain-materialization" as const,
      role,
      delivery,
      required,
      compositionId: tooling.receipt.compositionId as string,
      lockId: tooling.receipt.lockId as string,
      materializationDigest,
      ...(input.execution ? { execution: input.execution } : {}),
    };
    if (delivery === "embedded") {
      const relativePath = `attachments/${id}`;
      await cp(tooling.root, path.join(staging, ...relativePath.split("/")), {
        recursive: true,
        preserveTimestamps: false,
        verbatimSymlinks: true,
      });
      attachments.push({ ...base, path: relativePath });
      continue;
    }
    const fileName = `${id}.tar.zst`;
    const stagedPath = path.join(staging, ".sidecars", fileName);
    await mkdir(path.dirname(stagedPath), { recursive: true });
    const archive = await createDeterministicDirectoryArchive(
      tooling.root,
      stagedPath,
      request.signal,
    );
    const finalPath = path.join(path.dirname(output), fileName);
    sidecars.push({ stagedPath, finalPath, sha256: archive.sha256 });
    attachments.push({
      ...base,
      sidecar: { fileName, sha256: archive.sha256, size: archive.size },
    });
  }
  return { manifest: attachments, sidecars };
}

async function collectChecksumRows(root: string, relativeRoot: string): Promise<string[]> {
  const rows: string[] = [];
  const base = path.join(root, ...relativeRoot.split("/"));
  const visit = async (current: string) => {
    const dir = new Bun.Glob("**/*");
    for await (const relative of dir.scan({
      cwd: current,
      dot: true,
      onlyFiles: true,
      followSymlinks: false,
    })) {
      const absolute = path.join(current, relative);
      const rel = path.relative(root, absolute).replaceAll("\\", "/");
      rows.push(
        `${sha256(new Uint8Array(await Bun.file(absolute).arrayBuffer())).slice(7)}  ${rel}`,
      );
    }
  };
  if (await Bun.file(base).exists()) await visit(base);
  return rows.sort();
}

async function createRepositoryStateProjection(
  snapshot: GrSnapshot,
  staging: string,
  profile: GrBundleProfile,
) {
  if (profile === "source") return { kind: "none" as const };
  const relativePath = "metadata/gr/state.json";
  const file = path.join(staging, ...relativePath.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  const projection = {
    schemaVersion: "gr.repository-state-projection.v0",
    backend: snapshot.repository.backend,
    objectFormat: snapshot.repository.objectFormat,
    repositoryFingerprint: snapshot.repository.fingerprint,
    snapshot: {
      id: snapshot.snapshotId,
      fingerprint: snapshot.snapshotFingerprint,
      role: snapshot.role,
      origin: snapshot.origin,
      head: snapshot.head,
      indexTree: snapshot.indexTree,
      worktreeTree: snapshot.worktreeTree,
      statusFingerprint: snapshot.statusFingerprint,
      inspectionFingerprint: snapshot.inspectionFingerprint,
    },
  };
  const bytes = `${JSON.stringify(projection, null, 2)}\n`;
  await writeFile(file, bytes);
  return { kind: "git-projection" as const, path: relativePath, sha256: sha256(bytes) };
}

async function createGitHistoryProjection(
  root: string,
  staging: string,
  mode: GrBundlePolicyV0["history"],
  signal?: AbortSignal,
) {
  if (mode === "none") return { mode: "none" as const };
  const metadataDir = path.join(staging, "metadata", "gr");
  await mkdir(metadataDir, { recursive: true });
  const relativePath =
    mode === "commits" ? "metadata/gr/commits.ndjson" : "metadata/gr/refs.ndjson";
  const file = path.join(staging, ...relativePath.split("/"));
  let rows: string[] = [];
  if (mode === "refs") {
    const raw = await runRequiredGrGit(
      root,
      [
        "for-each-ref",
        "--format=%(refname)%00%(objectname)%00%(objecttype)",
        "refs/heads",
        "refs/remotes",
        "refs/tags",
      ],
      signal ? { signal } : {},
    );
    rows = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [ref, oid, objectType] = line.split("\0");
        return JSON.stringify({ ref, oid, objectType });
      });
  } else {
    const raw = await runRequiredGrGit(
      root,
      ["log", "--all", "--date-order", "--format=%H%x00%P%x00%ct%x00%D%x00%s"],
      signal ? { signal } : {},
    );
    rows = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [oid, parents, committedAtUnix, refs, subject] = line.split("\0");
        return JSON.stringify({
          oid,
          parents: parents ? parents.split(" ") : [],
          committedAtUnix: Number(committedAtUnix),
          refs: refs ? refs.split(", ").filter(Boolean) : [],
          subject: subject ?? "",
        });
      });
  }
  const bytes = `${rows.join("\n")}${rows.length ? "\n" : ""}`;
  await writeFile(file, bytes);
  return { mode, path: relativePath, sha256: sha256(bytes), entries: rows.length } as const;
}

export async function createGrRepositoryBundle(request: GrRepositoryBundleRequest) {
  assertGrEffects(
    ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
    request.grantedEffects,
  );
  const snapshot = parseGrSnapshot(request.snapshot);
  const root = path.resolve(request.root);
  if (path.resolve(snapshot.repository.root) !== root)
    throw new GrError(
      "GR_REPOSITORY_MISMATCH",
      "Repository bundle snapshot belongs to a different repository.",
    );

  const selectedPaths = [...new Set(request.paths ?? [])].sort();
  for (const selected of selectedPaths) {
    if (!selected || path.isAbsolute(selected) || selected.split(/[\\/]+/u).includes(".."))
      throw new GrError(
        "GR_INVALID_ARTIFACT",
        "Repository bundle path selection must be repository-relative.",
        { selected },
      );
  }

  const profile = request.profile ?? "handoff";
  if (profile === "offline" && normalizeToolingInputs(request.tooling).length === 0) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR offline bundle profile requires at least one tooling attachment.",
    );
  }
  const output = await resolveBundleOutput(root, snapshot, selectedPaths, request.output);
  const configPath = ".config/gr.json";
  const configNames = await runRequiredGrGit(
    root,
    ["ls-tree", "--name-only", snapshot.worktreeTree.oid, "--", configPath],
    request.signal ? { signal: request.signal } : {},
  );
  const repositoryConfigText =
    configNames.trim() === configPath
      ? await runRequiredGrGit(
          root,
          ["show", `${snapshot.worktreeTree.oid}:${configPath}`],
          request.signal ? { signal: request.signal } : {},
        )
      : null;
  const resolvedPolicy = await resolveGrBundlePolicy(root, { repositoryConfigText });
  const policy: GrBundlePolicyV0 =
    profile === "source" ? { ...resolvedPolicy, history: "none" } : resolvedPolicy;
  const staging = await mkdtemp(path.join(tmpdir(), "reliverse-gr-bundle-"));
  try {
    const repositoryDir = path.join(staging, "artifacts", "repository");
    await mkdir(repositoryDir, { recursive: true });
    const sourceTar = path.join(repositoryDir, "source.tar");
    const archiveArgs = [
      "git",
      "archive",
      "--format=tar",
      "--mtime=1970-01-01T00:00:00Z",
      `--output=${sourceTar}`,
      snapshot.worktreeTree.oid,
      "--",
    ];
    archiveArgs.push(...(selectedPaths.length ? selectedPaths : ["."]));
    for (const pattern of policy.exclude) archiveArgs.push(`:(glob,exclude)${pattern}`);
    await run(root, archiveArgs, request.signal);

    const namesRaw = await runRequiredGrGit(
      root,
      ["ls-tree", "-r", "--name-only", snapshot.worktreeTree.oid],
      request.signal ? { signal: request.signal } : {},
    );
    const names = namesRaw
      .split("\n")
      .filter(Boolean)
      .filter(
        (name) =>
          (selectedPaths.length === 0 ||
            selectedPaths.some(
              (p) => name === p || name.startsWith(`${p.replace(/\/$/u, "")}/`),
            )) &&
          !grBundlePathExcluded(name, policy),
      );
    const handoffEntries = names.filter(
      (name) =>
        /(^|\/)(handoff\.json|START-HERE\.md)$/u.test(name) || /(^|\/)handoff\//u.test(name),
    );

    const tooling = await prepareToolingAttachments(request, staging, output);
    const history = await createGitHistoryProjection(root, staging, policy.history, request.signal);
    const repositoryState = await createRepositoryStateProjection(snapshot, staging, profile);
    const continuation =
      profile === "source"
        ? ({ kind: "none" } as const)
        : await createGrPrivateContinuation(root, staging, {
            grantedEffects: ["filesystem.read", "filesystem.write"],
          });
    const sourceBytes = new Uint8Array(await Bun.file(sourceTar).arrayBuffer());
    const semantic = {
      schemaVersion: GR_REPOSITORY_BUNDLE_SCHEMA_VERSION,
      operation: "gr.repository.bundle.create" as const,
      profile,
      repository: snapshot.repository,
      snapshot: {
        id: snapshot.snapshotId,
        fingerprint: snapshot.snapshotFingerprint,
        tree: snapshot.worktreeTree,
      },
      selection: selectedPaths.length
        ? { kind: "paths" as const, paths: selectedPaths }
        : { kind: "workspace" as const },
      source: {
        path: "artifacts/repository/source.tar",
        sha256: sha256(sourceBytes),
        entries: names.length,
      },
      policy,
      history,
      repositoryState,
      handoff: { entries: handoffEntries },
      continuation,
      tooling: { attachments: tooling.manifest },
    };
    const bundleId = `gr-bundle-${sha256(JSON.stringify(semantic)).slice(7, 27)}`;
    const manifest: GrRepositoryBundleManifestV0 = { ...semantic, bundleId };
    const manifestPath = path.join(staging, "bundle.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const checksumRows = [
      `${sha256(new Uint8Array(await Bun.file(sourceTar).arrayBuffer())).slice(7)}  artifacts/repository/source.tar`,
      `${sha256(new Uint8Array(await Bun.file(manifestPath).arrayBuffer())).slice(7)}  bundle.json`,
    ];
    for (const attachment of tooling.manifest) {
      if (attachment.delivery === "embedded" && attachment.path) {
        checksumRows.push(...(await collectChecksumRows(staging, attachment.path)));
      }
    }
    if (history.mode !== "none") checksumRows.push(`${history.sha256.slice(7)}  ${history.path}`);
    if (repositoryState.kind !== "none")
      checksumRows.push(`${repositoryState.sha256.slice(7)}  ${repositoryState.path}`);
    if (continuation.kind !== "none")
      checksumRows.push(`${continuation.sha256.slice(7)}  ${continuation.path}`);
    await writeFile(path.join(staging, "checksums.sha256"), `${checksumRows.join("\n")}\n`);
    await mkdir(path.join(staging, "scripts"), { recursive: true });
    const toolingInstallLines = tooling.manifest.flatMap((attachment, index) => {
      const source = `$root/attachments/${attachment.id}`;
      const sourceAdoptable =
        tooling.manifest.filter((candidate) => candidate.id === attachment.id).length === 1;
      const isolatedDestination = `$stage/.reliverse-tooling/${attachment.role}`;
      const objectDigest = attachment.materializationDigest.slice("sha256:".length);
      const objectDestination = `$rpr_root/toolchains/sha256/${objectDigest}/root`;
      if (attachment.execution) {
        const executionRoot = `$stage/.private/reliverse/gr/execution/${attachment.id}`;
        const workspaceLinkLines = attachment.execution.workspaceLinks.flatMap((link) => {
          const linkPath = `node_modules/${link.packageName}`;
          const relativeTarget = path.posix.relative(
            path.posix.dirname(linkPath),
            link.repositoryPath,
          );
          return [
            `    mkdir -p "$(dirname -- "$stage/${linkPath}")"`,
            `    ln -s "${relativeTarget}" "$stage/${linkPath}"`,
          ];
        });
        const dependencyLinkLines = attachment.execution.dependencyLinks.flatMap((link) => {
          const linkPath = `${link.repositoryPath}/node_modules/${link.packageName}`;
          const targetPath = `.private/reliverse/gr/execution/${attachment.id}/${link.materializedPath}`;
          const relativeTarget = path.posix.relative(path.posix.dirname(linkPath), targetPath);
          return [
            `    rm -rf "$stage/${linkPath}"`,
            `    mkdir -p "$(dirname -- "$stage/${linkPath}")"`,
            `    ln -s "${relativeTarget}" "$stage/${linkPath}"`,
          ];
        });
        return [
          `status_${index}="unavailable"`,
          `location_${index}=""`,
          `if [ -d "${source}" ]; then`,
          `  lockfile="$stage/${attachment.execution.lockfile.path}"`,
          `  [ -f "$lockfile" ] || { echo "GR_BUNDLE_EXECUTION_LOCKFILE_MISSING:${attachment.id}" >&2; exit 18; }`,
          `  set -- $(sha256sum "$lockfile"); [ "$1" = "${attachment.execution.lockfile.sha256.slice(7)}" ] || { echo "GR_BUNDLE_EXECUTION_LOCKFILE_MISMATCH:${attachment.id}" >&2; exit 19; }`,
          `  rm -rf "${executionRoot}"; mkdir -p "$(dirname -- "${executionRoot}")"; if [ "$adopt_attachments" = "1" ] && [ "${sourceAdoptable ? "1" : "0"}" = "1" ]; then mv "${source}" "${executionRoot}"; else cp -a "${source}" "${executionRoot}"; fi`,
          `  rm -rf "$stage/node_modules"; mkdir -p "$stage/node_modules"`,
          `  for package in "${executionRoot}/node_modules"/*; do [ -e "$package" ] || [ -L "$package" ] || continue; name="$(basename -- "$package")"; case "$name" in @*) mkdir -p "$stage/node_modules/$name"; for scoped in "$package"/*; do [ -e "$scoped" ] || [ -L "$scoped" ] || continue; scoped_name="$(basename -- "$scoped")"; ln -s "../../.private/reliverse/gr/execution/${attachment.id}/node_modules/$name/$scoped_name" "$stage/node_modules/$name/$scoped_name"; done ;; *) ln -s "../.private/reliverse/gr/execution/${attachment.id}/node_modules/$name" "$stage/node_modules/$name" ;; esac; done`,
          ...workspaceLinkLines,
          ...dependencyLinkLines,
          `  status_${index}="installed-workspace-execution"; location_${index}=".private/reliverse/gr/execution/${attachment.id}"`,
          attachment.required
            ? `else echo "GR_BUNDLE_REQUIRED_EXECUTION_MISSING:${attachment.id}" >&2; exit 9`
            : `fi`,
          ...(attachment.required ? ["fi"] : []),
        ];
      }
      return [
        `status_${index}="unavailable"`,
        `location_${index}=""`,
        `if [ -d "${source}" ]; then`,
        `  if [ "$install_mode" = "isolated" ]; then`,
        `    mkdir -p "$stage/.reliverse-tooling"; if [ "$adopt_attachments" = "1" ] && [ "${sourceAdoptable ? "1" : "0"}" = "1" ]; then mv "${source}" "${isolatedDestination}"; else cp -a "${source}" "${isolatedDestination}"; fi; status_${index}="installed-isolated"; location_${index}=".reliverse-tooling/${attachment.role}"`,
        `  else`,
        `    object="${objectDestination}"`,
        `    if [ -d "$object" ]; then`,
        `      verifier="${source}/bin/gr"`,
        `      [ -x "$verifier" ] || { echo "GR_BUNDLE_TOOLING_VERIFIER_MISSING:${attachment.id}" >&2; exit 14; }`,
        `      "$verifier" bundle verify-tooling "$object" >/dev/null || { echo "GR_BUNDLE_EXISTING_TOOLING_INVALID:${attachment.id}" >&2; exit 15; }`,
        `      status_${index}="reused-user-rpr"`,
        `    else`,
        `      object_parent="$(dirname -- "$object")"; mkdir -p "$object_parent"`,
        `      object_tmp="$object_parent/.root.import.$$"; rm -rf "$object_tmp"; cp -a "${source}" "$object_tmp"`,
        `      verifier="$object_tmp/bin/gr"`,
        `      [ -x "$verifier" ] || { echo "GR_BUNDLE_TOOLING_VERIFIER_MISSING:${attachment.id}" >&2; rm -rf "$object_tmp"; exit 14; }`,
        `      "$verifier" bundle verify-tooling "$object_tmp" >/dev/null || { echo "GR_BUNDLE_IMPORTED_TOOLING_INVALID:${attachment.id}" >&2; rm -rf "$object_tmp"; exit 16; }`,
        `      if mv "$object_tmp" "$object" 2>/dev/null; then status_${index}="imported-user-rpr"; else rm -rf "$object_tmp"; [ -d "$object" ] || { echo "GR_BUNDLE_TOOLING_IMPORT_FAILED:${attachment.id}" >&2; exit 17; }; "${source}/bin/gr" bundle verify-tooling "$object" >/dev/null || exit 17; status_${index}="reused-user-rpr"; fi`,
        `    fi`,
        `    mkdir -p "$bin_root"`,
        `    for projection in "$object"/bin/*; do [ -e "$projection" ] || [ -L "$projection" ] || continue; name="$(basename -- "$projection")"; temp_link="$bin_root/.${attachment.id}.$name.$$"; rm -f "$temp_link"; ln -s "$projection" "$temp_link"; mv -f "$temp_link" "$bin_root/$name"; done`,
        `    location_${index}="$object"`,
        `  fi`,
        attachment.required
          ? `else echo "GR_BUNDLE_REQUIRED_TOOLING_MISSING:${attachment.id}" >&2; exit 9`
          : `fi`,
        ...(attachment.required ? ["fi"] : []),
      ];
    });
    const toolingReceiptLines = tooling.manifest.map(
      (attachment, index) =>
        `    {"id":"${attachment.id}","role":"${attachment.role}","delivery":"${attachment.delivery}","required":${attachment.required ? "true" : "false"},"status":"$status_${index}","location":"$location_${index}"}`,
    );
    const defaultInstallMode = profile === "offline" ? "host" : "isolated";
    const embeddedInstaller = [
      "#!/bin/sh",
      "set -eu",
      'root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"',
      'target="${1:-}"',
      `install_mode="\${2:-${defaultInstallMode}}"`,
      "[ -n \"$target\" ] || { echo 'usage: install.sh <target> [--isolated]' >&2; exit 2; }",
      '[ "$install_mode" = "--isolated" ] && install_mode="isolated"',
      '[ "$install_mode" = "host" ] || [ "$install_mode" = "isolated" ] || { echo "GR_BUNDLE_INSTALL_MODE_INVALID:$install_mode" >&2; exit 2; }',
      'adopt_attachments="${GR_BUNDLE_ADOPT_ATTACHMENTS:-0}"',
      '[ "$adopt_attachments" = "0" ] || [ "$adopt_attachments" = "1" ] || { echo "GR_BUNDLE_ADOPT_ATTACHMENTS_INVALID:$adopt_attachments" >&2; exit 2; }',
      'reliverse_home="${RELIVERSE_HOME:-$HOME/.reliverse}"',
      'rpr_root="$reliverse_home/rpr"',
      'bin_root="${RELIVERSE_BIN_ROOT:-$reliverse_home/bin}"',
      'for cmd in sha256sum tar mktemp find readlink realpath dirname basename mv cp ln rm; do command -v "$cmd" >/dev/null 2>&1 || { echo "GR_BUNDLE_HOST_COMMAND_MISSING:$cmd" >&2; exit 4; }; done',
      '(cd "$root" && sha256sum -c checksums.sha256)',
      'tar -tf "$root/artifacts/repository/source.tar" | while IFS= read -r entry; do case "$entry" in /*|../*|*/../*|*/..) echo "GR_BUNDLE_UNSAFE_SOURCE_PATH:$entry" >&2; exit 5;; esac; done',
      'parent="$(dirname -- "$target")"',
      'base="$(basename -- "$target")"',
      'mkdir -p "$parent"',
      'if [ -e "$target" ]; then [ -d "$target" ] && [ -z "$(ls -A "$target" 2>/dev/null)" ] || { echo "GR_BUNDLE_TARGET_NOT_EMPTY" >&2; exit 3; }; rmdir "$target"; fi',
      'stage="$(mktemp -d "$parent/.${base}.gr-install.XXXXXX")"',
      'cleanup() { [ -n "${stage:-}" ] && [ -d "$stage" ] && rm -rf "$stage"; }',
      "trap cleanup EXIT HUP INT TERM",
      'tar -xf "$root/artifacts/repository/source.tar" -C "$stage"',
      'check_symlinks() { tree="$1"; find "$tree" -type l -print | while IFS= read -r link; do dest="$(readlink "$link")" || exit 8; case "$dest" in /*) echo "GR_BUNDLE_UNSAFE_SYMLINK:$link" >&2; exit 8;; esac; resolved="$(realpath -m "$(dirname "$link")/$dest")" || exit 8; case "$resolved" in "$tree"|"$tree"/*) ;; *) echo "GR_BUNDLE_UNSAFE_SYMLINK:$link" >&2; exit 8;; esac; done; }',
      'check_symlinks "$stage"',
      ...toolingInstallLines,
      'check_symlinks "$stage"',
      'cat > "$stage/.gr-bundle-install.json" <<EOF',
      "{",
      '  "schemaVersion": "gr.repository-bundle-install-receipt.v0",',
      `  "bundleId": "${bundleId}",`,
      `  "profile": "${profile}",`,
      '  "toolingMode": "$install_mode",',
      '  "tooling": [',
      toolingReceiptLines
        .map((line, index) => `${line}${index + 1 < toolingReceiptLines.length ? "," : ""}`)
        .join("\n"),
      "  ]",
      "}",
      "EOF",
      'mv "$stage" "$target"',
      'stage=""',
      "trap - EXIT HUP INT TERM",
      'printf "%s\\n" "installed GR repository bundle into $target"',
      "",
    ].join("\n");
    await writeFile(path.join(staging, "scripts", "install.sh"), embeddedInstaller, {
      mode: 0o755,
    });

    const outputStem = output.endsWith(".tar.zst") ? output.slice(0, -".tar.zst".length) : output;
    for (const existingPath of [output, `${outputStem}.receipt.json`, `${outputStem}.install.sh`]) {
      if (await Bun.file(existingPath).exists()) {
        throw new GrError(
          "GR_INVALID_ARTIFACT",
          "GR bundle output already exists; refusing to overwrite an existing artifact.",
          { path: existingPath },
        );
      }
    }
    await mkdir(path.dirname(output), { recursive: true });
    await run(
      root,
      [
        "tar",
        "--sort=name",
        "--mtime=1970-01-01T00:00:00Z",
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "--exclude=.sidecars",
        "--zstd",
        "-cf",
        output,
        "-C",
        staging,
        ".",
      ],
      request.signal,
    );
    const archiveBytes = new Uint8Array(await Bun.file(output).arrayBuffer());
    const archiveDigest = sha256(archiveBytes);
    for (const sidecar of tooling.sidecars) {
      await mkdir(path.dirname(sidecar.finalPath), { recursive: true });
      if (await Bun.file(sidecar.finalPath).exists()) {
        const existing = sha256(new Uint8Array(await Bun.file(sidecar.finalPath).arrayBuffer()));
        if (existing !== sidecar.sha256) {
          throw new GrError(
            "GR_INVALID_ARTIFACT",
            "Existing GR tooling sidecar digest does not match the requested content identity.",
            { path: sidecar.finalPath },
          );
        }
      } else {
        await copyFile(sidecar.stagedPath, sidecar.finalPath);
      }
    }
    const receipt: GrRepositoryBundleReceiptV0 = {
      schemaVersion: GR_REPOSITORY_BUNDLE_RECEIPT_SCHEMA_VERSION,
      operation: "gr.repository.bundle.create",
      profile,
      bundleId,
      archive: { path: output, sha256: archiveDigest, size: (await stat(output)).size },
      manifest,
    };
    const sidecarStem = output.endsWith(".tar.zst") ? output.slice(0, -".tar.zst".length) : output;
    const receiptPath = `${sidecarStem}.receipt.json`;
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const installerPath = `${sidecarStem}.install.sh`;
    const archiveName = path.basename(output);
    const sidecarAttachments = tooling.manifest.filter(
      (attachment) => attachment.delivery === "sidecar" && attachment.sidecar,
    );
    const sidecarValidationLines = sidecarAttachments.flatMap((attachment) => {
      const sidecar = attachment.sidecar!;
      return [
        `sidecar="$self_dir/${sidecar.fileName}"`,
        `if [ -f "$sidecar" ]; then actual_sidecar="$(sha256sum "$sidecar" | awk '{print $1}')"; [ "$actual_sidecar" = "${sidecar.sha256.slice(7)}" ] || { echo "GR_BUNDLE_SIDECAR_DIGEST_MISMATCH:${attachment.id}" >&2; exit 10; }; tar --zstd -tf "$sidecar" | while IFS= read -r entry; do clean="\${entry#./}"; case "$clean" in /*|../*|*/../*|*/..) echo "GR_BUNDLE_UNSAFE_SIDECAR_PATH:$entry" >&2; exit 11;; esac; done;${attachment.required ? ' else echo "GR_BUNDLE_REQUIRED_SIDECAR_MISSING:' + attachment.id + '" >&2; exit 12;' : " fi"}`,
        ...(attachment.required ? ["fi"] : []),
      ];
    });
    const sidecarExtractionLines = (attachments: typeof sidecarAttachments) =>
      attachments.flatMap((attachment) => {
        const sidecar = attachment.sidecar!;
        return [
          `sidecar="$self_dir/${sidecar.fileName}"`,
          `if [ -f "$sidecar" ]; then mkdir -p "$tmp/attachments/${attachment.id}"; tar --zstd -xf "$sidecar" -C "$tmp/attachments/${attachment.id}"; fi`,
        ];
      });
    const bootstrapSidecarLines = sidecarExtractionLines(
      sidecarAttachments.filter((attachment) => attachment.role === "operator"),
    );
    const postBootstrapSidecarLines = sidecarExtractionLines(
      sidecarAttachments.filter((attachment) => attachment.role !== "operator"),
    );
    const externalInstaller = [
      "#!/bin/sh",
      "set -eu",
      'self_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
      `archive="$self_dir/${archiveName}"`,
      `expected="${archiveDigest.slice(7)}"`,
      'target="${1:-}"',
      `install_mode="\${2:-${defaultInstallMode}}"`,
      "[ -n \"$target\" ] || { echo 'usage: <bundle>.install.sh <target> [--isolated]' >&2; exit 2; }",
      'for cmd in sha256sum tar mktemp awk; do command -v "$cmd" >/dev/null 2>&1 || { echo "GR_BUNDLE_HOST_COMMAND_MISSING:$cmd" >&2; exit 4; }; done',
      'set -- $(sha256sum "$archive"); actual="$1"',
      '[ "$actual" = "$expected" ] || { echo "GR_BUNDLE_ARCHIVE_DIGEST_MISMATCH" >&2; exit 6; }',
      'tar --zstd -tf "$archive" | while IFS= read -r entry; do clean="\${entry#./}"; case "$clean" in /*|../*|*/../*|*/..) echo "GR_BUNDLE_UNSAFE_OUTER_PATH:$entry" >&2; exit 7;; esac; done',
      'tmp="$(mktemp -d)"',
      "trap 'rm -rf \"$tmp\"' EXIT HUP INT TERM",
      'tar --zstd -xf "$archive" -C "$tmp"',
      ...sidecarValidationLines,
      ...bootstrapSidecarLines,
      'stem="${archive%.tar.zst}"',
      'receipt="${stem}.receipt.json"',
      'if [ -f "$receipt" ]; then for verifier in "$tmp"/attachments/*/bin/gr; do [ -x "$verifier" ] || continue; "$verifier" bundle verify "$archive" >/dev/null || { echo "GR_BUNDLE_POST_BOOTSTRAP_VERIFY_FAILED" >&2; exit 13; }; break; done; fi',
      ...postBootstrapSidecarLines,
      'GR_BUNDLE_ADOPT_ATTACHMENTS=1 sh "$tmp/scripts/install.sh" "$target" "$install_mode"',
      "",
    ].join("\n");
    await writeFile(installerPath, externalInstaller, { mode: 0o755 });
    return Object.freeze({
      bundleId,
      archive: receipt.archive,
      receiptPath,
      installerPath,
      manifest,
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function readGrRepositoryBundleReceipt(
  receiptPath: string,
): Promise<GrRepositoryBundleReceiptV0> {
  const resolved = path.resolve(receiptPath);
  const value = JSON.parse(await readFile(resolved, "utf8")) as GrRepositoryBundleReceiptV0;
  if (
    value.schemaVersion !== GR_REPOSITORY_BUNDLE_RECEIPT_SCHEMA_VERSION ||
    value.operation !== "gr.repository.bundle.create" ||
    value.manifest?.schemaVersion !== GR_REPOSITORY_BUNDLE_SCHEMA_VERSION ||
    value.bundleId !== value.manifest.bundleId
  ) {
    throw new GrError("GR_INVALID_ARTIFACT", "Invalid GR repository bundle receipt.", {
      receiptPath: resolved,
    });
  }
  return value;
}

export async function verifyGrRepositoryBundleArtifact(options: {
  readonly archive: string;
  readonly receipt?: string;
  readonly signal?: AbortSignal;
}) {
  const archive = path.resolve(options.archive);
  const receiptPath = path.resolve(
    options.receipt ??
      `${archive.endsWith(".tar.zst") ? archive.slice(0, -".tar.zst".length) : archive}.receipt.json`,
  );
  const receipt = await readGrRepositoryBundleReceipt(receiptPath);
  const diagnostics: string[] = [];
  if (!(await Bun.file(archive).exists())) diagnostics.push("archive-missing");
  else {
    const archiveDigest = sha256(new Uint8Array(await Bun.file(archive).arrayBuffer()));
    if (archiveDigest !== receipt.archive.sha256) diagnostics.push("archive-digest-mismatch");
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics, receipt };

  const staging = await mkdtemp(path.join(tmpdir(), "reliverse-gr-bundle-verify-"));
  try {
    const listed = Bun.spawn(["tar", "--zstd", "-tf", archive], {
      stdout: "pipe",
      stderr: "pipe",
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const [listCode, listOutput, listError] = await Promise.all([
      listed.exited,
      Bun.readableStreamToText(listed.stdout),
      Bun.readableStreamToText(listed.stderr),
    ]);
    if (listCode !== 0) diagnostics.push(`outer-list-failed:${listError.trim()}`);
    for (const entry of listOutput.split("\n").filter(Boolean)) {
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
    if (diagnostics.length > 0) return { ok: false, diagnostics, receipt };

    const extracted = Bun.spawn(["tar", "--zstd", "-xf", archive, "-C", staging], {
      stdout: "pipe",
      stderr: "pipe",
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const [extractCode, extractError] = await Promise.all([
      extracted.exited,
      Bun.readableStreamToText(extracted.stderr),
    ]);
    if (extractCode !== 0) diagnostics.push(`outer-extract-failed:${extractError.trim()}`);
    if (diagnostics.length > 0) return { ok: false, diagnostics, receipt };

    const manifest = JSON.parse(
      await readFile(path.join(staging, "bundle.json"), "utf8"),
    ) as GrRepositoryBundleManifestV0;
    if (manifest.bundleId !== receipt.bundleId) diagnostics.push("manifest-bundle-id-mismatch");
    const checksum = Bun.spawn(["sha256sum", "-c", "checksums.sha256"], {
      cwd: staging,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [checksumCode, checksumError] = await Promise.all([
      checksum.exited,
      Bun.readableStreamToText(checksum.stderr),
    ]);
    if (checksumCode !== 0) diagnostics.push(`payload-checksum-mismatch:${checksumError.trim()}`);

    for (const attachment of manifest.tooling.attachments) {
      if (attachment.delivery === "embedded" && attachment.path) {
        const verification = await verifyRprToolchainMaterialization(
          path.join(staging, ...attachment.path.split("/")),
        );
        if (!verification.ok) {
          diagnostics.push(
            ...verification.diagnostics.map((item) => `tooling:${attachment.id}:${item}`),
          );
        }
        continue;
      }
      if (attachment.delivery === "sidecar" && attachment.sidecar) {
        const sidecar = path.join(path.dirname(archive), attachment.sidecar.fileName);
        if (!(await Bun.file(sidecar).exists())) {
          if (attachment.required) diagnostics.push(`sidecar-required-missing:${attachment.id}`);
          continue;
        }
        const digest = sha256(new Uint8Array(await Bun.file(sidecar).arrayBuffer()));
        if (digest !== attachment.sidecar.sha256) {
          diagnostics.push(`sidecar-digest-mismatch:${attachment.id}`);
          continue;
        }
        const sidecarRoot = path.join(staging, ".sidecar-verification", attachment.id);
        await mkdir(sidecarRoot, { recursive: true });
        try {
          const listedSidecar = Bun.spawn(["tar", "--zstd", "-tf", sidecar], {
            stdout: "pipe",
            stderr: "pipe",
            ...(options.signal ? { signal: options.signal } : {}),
          });
          const [sidecarListCode, sidecarListOutput, sidecarListError] = await Promise.all([
            listedSidecar.exited,
            Bun.readableStreamToText(listedSidecar.stdout),
            Bun.readableStreamToText(listedSidecar.stderr),
          ]);
          if (sidecarListCode !== 0) {
            diagnostics.push(`sidecar-list-failed:${attachment.id}:${sidecarListError.trim()}`);
            continue;
          }
          let unsafeSidecar = false;
          for (const entry of sidecarListOutput.split("\n").filter(Boolean)) {
            const clean = entry.replace(/^\.\//u, "");
            if (
              clean.startsWith("/") ||
              clean === ".." ||
              clean.startsWith("../") ||
              clean.includes("/../")
            ) {
              diagnostics.push(`sidecar-unsafe-path:${attachment.id}:${entry}`);
              unsafeSidecar = true;
            }
          }
          if (unsafeSidecar) continue;
          const extractedSidecar = Bun.spawn(["tar", "--zstd", "-xf", sidecar, "-C", sidecarRoot], {
            stdout: "pipe",
            stderr: "pipe",
            ...(options.signal ? { signal: options.signal } : {}),
          });
          const [sidecarExtractCode, sidecarExtractError] = await Promise.all([
            extractedSidecar.exited,
            Bun.readableStreamToText(extractedSidecar.stderr),
          ]);
          if (sidecarExtractCode !== 0) {
            diagnostics.push(
              `sidecar-extract-failed:${attachment.id}:${sidecarExtractError.trim()}`,
            );
            continue;
          }
          const toolingVerification = await verifyRprToolchainMaterialization(sidecarRoot);
          if (!toolingVerification.ok) {
            diagnostics.push(
              ...toolingVerification.diagnostics.map((item) => `tooling:${attachment.id}:${item}`),
            );
          }
        } finally {
          await rm(sidecarRoot, { recursive: true, force: true });
        }
      }
    }
    return { ok: diagnostics.length === 0, diagnostics, receipt, manifest };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
