import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { RELIVERSE_HOME_CONTRIBUTIONS } from "./contracts";
import {
  RELIVERSE_HOME_GITIGNORE,
  RELIVERSE_HOME_PRE_COMMIT_HOOK,
  inspectReliverseHomeGit,
  isKnownReliverseHomeGitPolicyMigration,
  verifyReliverseHomeGitPolicy,
} from "./git";
import {
  RELIVERSE_HOME_SCHEMA,
  RELIVERSE_PRINCIPAL_SCHEMA,
  type ReliverseHomeDiagnostic,
  type ReliverseHomeId,
  type ReliverseHomeInitPlan,
  type ReliverseHomeInspection,
  type ReliverseHomeManifestV0,
  type ReliversePrincipalV0,
} from "./model";
import {
  createReliverseHomePathSet,
  isOpaquePrincipalDirectoryName,
  resolveReliverseHomeRoot,
} from "./paths";
import { createReliversePrincipal, validateReliversePrincipal } from "./principal";

function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function createHomeId(): ReliverseHomeId {
  return `home_${randomUUID().replaceAll("-", "")}`;
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function validateHomeManifest(input: unknown): readonly string[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return Object.freeze(["Home manifest must be an object."]);
  }
  const record = input as Record<string, unknown>;
  const diagnostics: string[] = [];
  if (record.schema !== RELIVERSE_HOME_SCHEMA) diagnostics.push("Unsupported Home schema.");
  if (typeof record.id !== "string" || !/^home_[0-9a-f]{32}$/u.test(record.id)) {
    diagnostics.push("Home id must be an opaque home_ identifier.");
  }
  if (
    typeof record.defaultPrincipalId !== "string" ||
    !/^prn_[0-9a-f]{32}$/u.test(record.defaultPrincipalId)
  ) {
    diagnostics.push("defaultPrincipalId must be an opaque prn_ identifier.");
  }
  if (typeof record.createdAt !== "string" || Number.isNaN(Date.parse(record.createdAt))) {
    diagnostics.push("Home createdAt must be an ISO timestamp.");
  }
  return Object.freeze(diagnostics);
}

async function assertRootSafe(root: string): Promise<void> {
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("RELIVERSE_HOME_ROOT_INVALID: Home root must be a real directory.");
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { readonly code?: unknown }).code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

export async function planReliverseHomeInit(input: {
  readonly root?: string | undefined;
  readonly principalHandle: string;
  readonly displayName?: string | undefined;
  readonly hostUser?: string | undefined;
}): Promise<ReliverseHomeInitPlan> {
  const root = resolveReliverseHomeRoot({ override: input.root });
  await assertRootSafe(root);
  const manifestPath = path.join(root, "home.json");
  const existing = await pathExists(manifestPath);
  let home: ReliverseHomeManifestV0;
  let principal: ReliversePrincipalV0;

  if (existing) {
    const rawHome = await readJson(manifestPath);
    const homeDiagnostics = validateHomeManifest(rawHome);
    if (homeDiagnostics.length > 0) {
      throw new Error(`RELIVERSE_HOME_MANIFEST_INVALID: ${homeDiagnostics.join(" ")}`);
    }
    home = rawHome as ReliverseHomeManifestV0;
    const principalPath = path.join(root, "principals", home.defaultPrincipalId, "principal.json");
    const rawPrincipal = await readJson(principalPath);
    const principalDiagnostics = validateReliversePrincipal(rawPrincipal);
    if (principalDiagnostics.length > 0) {
      throw new Error(`RELIVERSE_HOME_PRINCIPAL_INVALID: ${principalDiagnostics.join(" ")}`);
    }
    principal = rawPrincipal as ReliversePrincipalV0;
    const requested = input.principalHandle.trim().toLowerCase();
    if (requested && requested !== principal.handle) {
      throw new Error(
        `RELIVERSE_HOME_PRINCIPAL_CONFLICT: Existing default principal is ${principal.handle}, not ${requested}.`,
      );
    }
  } else {
    principal = createReliversePrincipal({
      handle: input.principalHandle,
      displayName: input.displayName,
      hostUser: input.hostUser,
    });
    const createdAt = principal.createdAt;
    home = Object.freeze({
      schema: RELIVERSE_HOME_SCHEMA,
      id: createHomeId(),
      createdAt,
      defaultPrincipalId: principal.id,
      git: Object.freeze({ mode: "shared", remote: "none" }),
      contributions: Object.freeze(RELIVERSE_HOME_CONTRIBUTIONS.map((entry) => entry.id)),
    });
  }

  const paths = createReliverseHomePathSet(root, principal.id);
  const directories = Object.freeze([
    root,
    paths.principals,
    path.dirname(paths.defaultPrincipal),
    paths.objects,
    paths.store,
    paths.secrets,
    paths.rse,
    path.join(paths.rse, "agents"),
    path.join(paths.rse, "spaces"),
    path.join(paths.rse, "sandboxes"),
    path.join(paths.rse, "plugins"),
    path.join(paths.rse, "gateway"),
    path.join(paths.rse, "registry"),
    path.join(paths.rse, "providers"),
    path.join(paths.rse, "state"),
    path.join(paths.rse, "receipts"),
    path.join(paths.rse, "cache"),
    path.join(paths.rse, "logs"),
    path.join(paths.rse, "tmp"),
    paths.rempts,
    paths.dcs,
    paths.hooks,
  ]);
  const writes = Object.freeze([
    Object.freeze({ path: paths.manifest, content: stringify(home), mode: 0o600 }),
    Object.freeze({ path: paths.defaultPrincipal, content: stringify(principal), mode: 0o600 }),
    Object.freeze({ path: paths.gitignore, content: RELIVERSE_HOME_GITIGNORE, mode: 0o644 }),
    Object.freeze({
      path: paths.preCommitHook,
      content: RELIVERSE_HOME_PRE_COMMIT_HOOK,
      mode: 0o755,
    }),
  ]);

  return Object.freeze({
    format: "reliverse.home-init-plan.v0",
    root,
    home,
    principal,
    directories,
    writes,
    existing,
  });
}

async function replaceAtomic(filePath: string, content: string, mode: number): Promise<void> {
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode, flag: "wx" });
    await rename(temporary, filePath);
    await chmod(filePath, mode);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function writeAtomic(filePath: string, content: string, mode: number): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (await pathExists(filePath)) {
    const current = await readFile(filePath, "utf8");
    if (current !== content) {
      if (!isKnownReliverseHomeGitPolicyMigration({ filePath, current, next: content })) {
        throw new Error(`RELIVERSE_HOME_FILE_CONFLICT: Refusing to overwrite ${filePath}.`);
      }
      await replaceAtomic(filePath, content, mode);
      return;
    }
    await chmod(filePath, mode);
    return;
  }
  await replaceAtomic(filePath, content, mode);
}

export async function applyReliverseHomeInitPlan(
  plan: ReliverseHomeInitPlan,
): Promise<ReliverseHomeInspection> {
  await assertRootSafe(plan.root);
  for (const directory of plan.directories) await mkdir(directory, { recursive: true });
  await chmod(path.join(plan.root, "secrets"), 0o700);
  for (const write of plan.writes) await writeAtomic(write.path, write.content, write.mode);
  return inspectReliverseHome(plan.root);
}

export async function inspectReliverseHome(rootInput?: string): Promise<ReliverseHomeInspection> {
  const root = resolveReliverseHomeRoot({ override: rootInput });
  const fallbackPrincipal = "prn_00000000000000000000000000000000" as const;
  let paths = createReliverseHomePathSet(root, fallbackPrincipal);
  const diagnostics: ReliverseHomeDiagnostic[] = [];
  const exists = await pathExists(root);
  let manifest: ReliverseHomeManifestV0 | undefined;
  let principal: ReliversePrincipalV0 | undefined;

  if (!exists) {
    return Object.freeze({
      format: "reliverse.home-inspection.v0",
      root,
      exists: false,
      ok: false,
      paths,
      diagnostics: Object.freeze([
        Object.freeze({
          code: "RELIVERSE_HOME_MISSING",
          message: "Reliverse Home has not been initialized.",
          severity: "warning" as const,
          path: root,
          remediation: "Run `rse home init --principal-handle <handle> --apply`.",
        }),
      ]),
      git: Object.freeze({ initialized: false, remoteCount: 0 }),
    });
  }

  try {
    const raw = await readJson(path.join(root, "home.json"));
    const problems = validateHomeManifest(raw);
    for (const message of problems)
      diagnostics.push({
        code: "RELIVERSE_HOME_MANIFEST_INVALID",
        message,
        severity: "error",
        path: path.join(root, "home.json"),
      });
    if (problems.length === 0) {
      manifest = raw as ReliverseHomeManifestV0;
      paths = createReliverseHomePathSet(root, manifest.defaultPrincipalId);
    }
  } catch (error) {
    diagnostics.push({
      code: "RELIVERSE_HOME_MANIFEST_READ_FAILED",
      message: error instanceof Error ? error.message : String(error),
      severity: "error",
      path: path.join(root, "home.json"),
    });
  }

  if (manifest) {
    try {
      const raw = await readJson(paths.defaultPrincipal);
      const problems = validateReliversePrincipal(raw);
      for (const message of problems)
        diagnostics.push({
          code: "RELIVERSE_HOME_PRINCIPAL_INVALID",
          message,
          severity: "error",
          path: paths.defaultPrincipal,
        });
      if (problems.length === 0) principal = raw as ReliversePrincipalV0;
    } catch (error) {
      diagnostics.push({
        code: "RELIVERSE_HOME_PRINCIPAL_READ_FAILED",
        message: error instanceof Error ? error.message : String(error),
        severity: "error",
        path: paths.defaultPrincipal,
      });
    }
  }

  try {
    const ownerDirectories = await readdir(path.join(root, "rse", "agents"), {
      withFileTypes: true,
    });
    for (const entry of ownerDirectories) {
      if (entry.isDirectory() && !isOpaquePrincipalDirectoryName(entry.name)) {
        diagnostics.push({
          code: "RELIVERSE_HOME_AGENT_OWNER_PATH_NONCANONICAL",
          message: `Agent owner directory ${entry.name} is a display name, not an opaque Principal ID.`,
          severity: "error",
          path: path.join(root, "rse", "agents", entry.name),
          remediation:
            "Use rse/agents/<principal-id>/<agent-id>; keep handles in identity metadata.",
        });
      }
    }
  } catch {
    // The runtime creates directories lazily; absence is not a failure.
  }

  for (const code of await verifyReliverseHomeGitPolicy(root)) {
    diagnostics.push({
      code,
      message: "Shared Home Git policy files are missing or drifted from Home Contracts.",
      severity: "error",
      remediation: "Re-run `rse home init --apply` after reviewing local changes.",
    });
  }

  const git = await inspectReliverseHomeGit(root);
  if (git.initialized && git.remoteCount > 0) {
    diagnostics.push({
      code: "RELIVERSE_HOME_GIT_REMOTE_PRESENT",
      message: "Reliverse Home has a Git remote, while v0 defaults to local-only shared Git.",
      severity: "warning",
      remediation:
        "Keep the remote only after explicit owner review of privacy and secret boundaries.",
    });
  }
  if (git.initialized && git.hooksPath !== ".reliverse-hooks") {
    diagnostics.push({
      code: "RELIVERSE_HOME_GIT_HOOKS_PATH_INVALID",
      message: "Shared Home Git does not use the managed pre-commit guard.",
      severity: "error",
      remediation: "Run `rse home git init --apply`.",
    });
  }

  return Object.freeze({
    format: "reliverse.home-inspection.v0",
    root,
    exists,
    ok: diagnostics.every((entry) => entry.severity !== "error"),
    ...(manifest ? { manifest } : {}),
    ...(principal ? { principal } : {}),
    paths,
    diagnostics: Object.freeze(diagnostics.map((entry) => Object.freeze(entry))),
    git,
  });
}
