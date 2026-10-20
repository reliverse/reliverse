import { defineRepositoryRule } from "../shared/rules";

export const REPO_LOCKFILE_RULE_IDS = Object.freeze({
  present: "repo.lockfile.present",
  workspaceEntry: "repo.lockfile.workspace-entry",
  workspaceMetadata: "repo.lockfile.workspace-metadata",
  packageAlias: "repo.lockfile.package-alias",
  staleWorkspace: "repo.lockfile.stale-workspace",
} as const);

export const REPO_LOCKFILE_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.lockfile",
    "present",
    "Readable Bun lockfile",
    "The repository contains a readable bun.lock.",
    "Deterministic installation requires committed lock state.",
    "Generate and commit a valid bun.lock on a connected host.",
  ),
  defineRepositoryRule(
    "repo.lockfile",
    "workspace-entry",
    "Lockfile workspace entry",
    "Every declared workspace has lockfile metadata.",
    "Bun must resolve each workspace from committed lock state.",
    "Regenerate bun.lock after workspace changes.",
  ),
  defineRepositoryRule(
    "repo.lockfile",
    "workspace-metadata",
    "Lockfile workspace metadata",
    "Workspace identity and dependency metadata match package manifests.",
    "Stale metadata can produce installation results that differ from source manifests.",
    "Regenerate bun.lock from the current manifests.",
  ),
  defineRepositoryRule(
    "repo.lockfile",
    "package-alias",
    "Lockfile package alias",
    "Named workspaces have the expected workspace package alias.",
    "Package aliases connect dependency names to local workspace paths.",
    "Regenerate bun.lock to restore the alias.",
  ),
  defineRepositoryRule(
    "repo.lockfile",
    "stale-workspace",
    "No stale lockfile workspace",
    "The lockfile does not retain removed workspaces.",
    "Stale workspace metadata hides repository topology drift.",
    "Regenerate bun.lock after removing the workspace.",
  ),
]);
