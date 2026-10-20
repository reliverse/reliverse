import { defineRepositoryRule } from "../shared/rules";

export const REPO_PATHS_RULE_IDS = Object.freeze({
  workspaceCoverage: "repo.paths.workspace-coverage",
  canonicalPath: "repo.paths.canonical-path",
  retiredPrefix: "repo.paths.retired-prefix",
  rvsFamilyPrefix: "repo.paths.rvs-family-prefix",
  forbiddenTrackedPath: "repo.paths.forbidden-tracked-path",
  trackedPathInspection: "repo.paths.tracked-path-inspection",
} as const);

export const REPO_PATHS_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.paths",
    "workspace-coverage",
    "Workspace path coverage",
    "Non-fixture package manifests are selected by root workspace patterns.",
    "Unselected packages are invisible to workspace tooling and policy.",
    "Add the package family to workspaces or remove the orphan manifest.",
  ),
  defineRepositoryRule(
    "repo.paths",
    "canonical-path",
    "Canonical repository path",
    "Reviewed architecture paths remain present.",
    "These paths are stable ownership coordinates used by repository tooling and documentation.",
    "Restore the canonical path or update the reviewed path policy.",
  ),
  defineRepositoryRule(
    "repo.paths",
    "retired-prefix",
    "No retired path prefix",
    "Operational files do not reference removed repository roots.",
    "Stale paths bypass current package and extension ownership.",
    "Replace the reference with its canonical repository path.",
  ),
  defineRepositoryRule(
    "repo.paths",
    "rvs-family-prefix",
    "RVS family path prefix",
    "RVS family package references use rvs-prefixed leaf paths.",
    "Family-prefixed directories make ownership explicit and avoid ambiguous package roots.",
    "Use packages/rvs/rvs-<name>.",
  ),
  defineRepositoryRule(
    "repo.paths",
    "forbidden-tracked-path",
    "No tracked transient handoff",
    "Repository-local transient handoff files are never staged or committed.",
    "Agent continuity may contain local or sensitive context and is not a durable repository source of truth.",
    "Remove the path from the Git index while retaining the ignored local file if needed.",
  ),
  defineRepositoryRule(
    "repo.paths",
    "tracked-path-inspection",
    "Readable Git tracked-path state",
    "RQ can inspect the selected repository Git index before accepting tracked-path policy.",
    "Failing open would allow forbidden transient paths to enter repository history undetected.",
    "Run the gate in a valid Git worktree with Git available.",
  ),
]);
