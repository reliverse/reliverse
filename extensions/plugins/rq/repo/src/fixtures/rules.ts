import { defineRepositoryRule } from "../shared/rules";

export const REPO_FIXTURE_RULE_IDS = Object.freeze({
  sharedLocation: "repo.fixtures.shared-location",
  buildMetadata: "repo.fixtures.build-metadata",
  staleReference: "repo.fixtures.stale-reference",
} as const);

export const REPO_FIXTURE_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.fixtures",
    "shared-location",
    "Shared fixture location",
    "Root shared fixtures live under tests/fixtures.",
    "A single governed shared-fixture root prevents ambiguous ownership and stale path conventions.",
    "Move the shared fixture under tests/fixtures.",
  ),
  defineRepositoryRule(
    "repo.fixtures",
    "build-metadata",
    "No committed TypeScript build metadata",
    "Generated tsbuildinfo files are not committed as repository fixtures.",
    "TypeScript incremental metadata is environment-bound generated state.",
    "Remove the generated tsbuildinfo file and ignore it.",
  ),
  defineRepositoryRule(
    "repo.fixtures",
    "stale-reference",
    "Current fixture references",
    "Operational sources do not reference retired root fixture paths.",
    "Shared fixtures moved under tests/fixtures and operational references must follow that ownership.",
    "Update the reference to tests/fixtures.",
  ),
]);
