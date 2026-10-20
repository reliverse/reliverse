import { defineRepositoryRule } from "../shared/rules";

export const REPO_SPECS_RULE_IDS = Object.freeze({
  duplicateGeneration: "repo.specs.duplicate-generation",
  historicalArtifact: "repo.specs.historical-artifact",
  manifestDrift: "repo.specs.manifest-drift",
  canonicalMetadata: "repo.specs.canonical-metadata",
  oversizedFile: "repo.specs.oversized-file",
  versionedLivingSpec: "repo.specs.versioned-living-spec",
});

export const REPO_SPECS_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.specs",
    "manifest-drift",
    "Generated Spec manifest is current",
    "Every configured Spec manifest exists and matches the exact current Markdown inventory.",
    "The manifest is deterministic authority metadata used by agents, RQ, and Rse Spec doctor.",
    "Run rse spec inventory --apply and review the resulting repository diff.",
    "error",
  ),
  defineRepositoryRule(
    "repo.specs",
    "canonical-metadata",
    "Canonical Spec metadata is complete",
    "Canonical manifest entries carry valid kind, status, authority, implementation, authorship, and review metadata.",
    "Canonical scope must be explicit even while legacy corpus adoption remains guided.",
    "Repair the canonical Spec frontmatter, then regenerate the manifest.",
    "error",
  ),
  defineRepositoryRule(
    "repo.specs",
    "versioned-living-spec",
    "Stable living specification identity",
    "Living specification filenames and H1 titles do not carry v0/v1-style generations.",
    "A feature specification is continuously upgraded; machine schema versions are separate contracts.",
    "Rename the living specification and merge unique content before retiring older generations.",
    "warning",
  ),
  defineRepositoryRule(
    "repo.specs",
    "duplicate-generation",
    "No parallel filename generations",
    "Living specifications do not use suffixes such as -2, -final, -fixed, copy, or retry.",
    "Parallel filenames hide authority and split unique guidance across accidental generations.",
    "Inventory both documents, merge unique claims into a stable feature specification, and retire the duplicates.",
    "warning",
  ),
  defineRepositoryRule(
    "repo.specs",
    "oversized-file",
    "Bounded specification size",
    "Specifications stay within the configured line budget or are explicitly exempted.",
    "Large mixed documents overload human and agent context and make authority difficult to review.",
    "Mechanically split the file by headings into private migration fragments, then merge them into coherent feature specs.",
    "warning",
  ),
  defineRepositoryRule(
    "repo.specs",
    "historical-artifact",
    "No implementation-history leakage",
    "Living specifications do not narrate temporary stages, patch archives, or handoff closure filenames.",
    "Specs describe durable future architecture; temporary campaign history belongs in private Handoffs or evidence.",
    "Extract durable rules, then remove or relocate the historical narration.",
    "warning",
  ),
]);
