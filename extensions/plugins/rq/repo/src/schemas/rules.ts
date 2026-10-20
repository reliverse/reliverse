import { defineRepositoryRule } from "../shared/rules";

export const REPO_SCHEMAS_RULE_IDS = Object.freeze({
  numericGeneration: "repo.schemas.numeric-generation",
  ownedFormatGeneration: "repo.schemas.owned-format-generation",
  versionedContractFilename: "repo.schemas.versioned-contract-filename",
});

export const REPO_SCHEMAS_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.schemas",
    "numeric-generation",
    "Pre-1 numeric schema generation",
    "Active Reliverse-owned serialized contracts use schemaVersion: 0 while the repository root remains below 1.0.0.",
    "Unpublished internal schema generations do not need runtime compatibility ladders.",
    "Keep the newest accepted shape, reset it to schemaVersion: 0, and remove obsolete internal readers or migrators.",
    "error",
  ),
  defineRepositoryRule(
    "repo.schemas",
    "owned-format-generation",
    "Pre-1 owned format identifier",
    "Reliverse-owned format identifiers end in .v0 or /v0 while the repository root remains below 1.0.0.",
    "Owned v1+ identifiers accidentally freeze unpublished implementation history into durable contracts.",
    "Classify the marker, preserve external protocols, and reset the accepted owned format to v0.",
    "error",
  ),
  defineRepositoryRule(
    "repo.schemas",
    "versioned-contract-filename",
    "Stable active contract filename",
    "Active source filenames do not carry v1/v2-style generations unless explicitly exempted.",
    "The accepted pre-1 shape replaces older generations instead of accumulating parallel modules.",
    "Rename the accepted module to a stable feature name and update imports after removing obsolete generations.",
    "warning",
  ),
]);
