import { defineRepositoryRule } from "../shared/rules";

export const REPO_PACKAGES_RULE_IDS = Object.freeze({
  familyManifest: "repo.packages.family-manifest",
  familyName: "repo.packages.family-name",
  manifestJson: "repo.packages.manifest-json",
  privateExplicit: "repo.packages.private-explicit",
  publicAccess: "repo.packages.public-access",
  exportsDeclared: "repo.packages.exports-declared",
  exportTarget: "repo.packages.export-target",
  bunRuntimeFloor: "repo.packages.bun-runtime-floor",
} as const);

export const REPO_PACKAGES_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.packages",
    "family-manifest",
    "Package family manifest",
    "Every package-family directory contains a package manifest.",
    "Package family directories are package ownership boundaries and must contain package.json.",
    "Add the missing package manifest or remove the orphan directory.",
  ),
  defineRepositoryRule(
    "repo.packages",
    "family-name",
    "Package family identity",
    "Package family directory names agree with package identities.",
    "Reliverse family packages use the leaf directory as their unscoped package identity.",
    "Align the package name and family directory.",
  ),
  defineRepositoryRule(
    "repo.packages",
    "manifest-json",
    "Valid package manifest",
    "Package manifests contain valid JSON.",
    "Repository tooling cannot safely reason about malformed package manifests.",
    "Repair the package manifest JSON.",
  ),
  defineRepositoryRule(
    "repo.packages",
    "private-explicit",
    "Explicit package visibility",
    "Package manifests explicitly declare whether they are private.",
    "Explicit visibility prevents accidental publication or accidental exclusion from publication.",
    "Set the private field explicitly.",
  ),
  defineRepositoryRule(
    "repo.packages",
    "public-access",
    "Public package access",
    "Public packages declare public publish access.",
    "Scoped public packages must opt into public registry access explicitly.",
    "Set publishConfig.access to public.",
  ),
  defineRepositoryRule(
    "repo.packages",
    "exports-declared",
    "Declared package exports",
    "Package family manifests declare their public exports.",
    "Explicit exports define the package boundary consumed by other workspaces and users.",
    "Declare the package exports map.",
  ),
  defineRepositoryRule(
    "repo.packages",
    "export-target",
    "Existing export targets",
    "Relative package export targets exist on disk.",
    "A declared export must resolve to a file included in the package source tree.",
    "Create or correct the missing export target.",
  ),
  defineRepositoryRule(
    "repo.packages",
    "bun-runtime-floor",
    "Bun runtime floor",
    "The repository root requires Bun >=1.4.2 and package manifests may not weaken that floor.",
    "Reliverse runtime/tooling semantics rely on the Bun 1.4+ Rust implementation baseline.",
    "Set root engines.bun to >=1.4.2, packageManager to bun@1.4.2 or newer, and remove weaker package-local Bun floors.",
  ),
]);
