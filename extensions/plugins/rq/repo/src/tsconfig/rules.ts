import { defineRepositoryRule } from "../shared/rules";

export const REPO_TSCONFIG_RULE_IDS = Object.freeze({
  validJsonc: "repo.tsconfig.valid-jsonc",
  sharedPreset: "repo.tsconfig.shared-preset",
  sharedToolchain: "repo.tsconfig.shared-toolchain",
  importExtensions: "repo.tsconfig.import-extensions",
  familyConfig: "repo.tsconfig.family-config",
  typecheckScript: "repo.tsconfig.typecheck-script",
} as const);

export const REPO_TSCONFIG_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.tsconfig",
    "valid-jsonc",
    "Valid TypeScript configuration",
    "Workspace tsconfig files contain valid JSONC objects.",
    "Invalid project configuration cannot participate in deterministic repository typechecking.",
    "Repair the tsconfig JSONC.",
  ),
  defineRepositoryRule(
    "repo.tsconfig",
    "shared-preset",
    "Shared TypeScript preset",
    "Workspace tsconfig files extend an approved public shared preset.",
    "Shared presets keep compiler semantics consistent across the workspace graph.",
    "Extend an approved @repo/tsconfig preset.",
  ),
  defineRepositoryRule(
    "repo.tsconfig",
    "shared-toolchain",
    "Shared TypeScript toolchain",
    "Workspace packages with tsconfig declare the shared compiler and type supply.",
    "Explicit workspace toolchain dependencies make package-local typechecks reproducible.",
    "Declare the required shared TypeScript devDependencies.",
  ),
  defineRepositoryRule(
    "repo.tsconfig",
    "import-extensions",
    "Portable import extension policy",
    "TypeScript configurations do not enable source-extension imports.",
    "allowImportingTsExtensions couples module specifiers to source-only TypeScript paths.",
    "Remove allowImportingTsExtensions or set it to false.",
  ),
  defineRepositoryRule(
    "repo.tsconfig",
    "family-config",
    "Package family tsconfig",
    "Package family workspaces contain tsconfig.json.",
    "Every typed package in the governed families needs an explicit project configuration.",
    "Add the missing tsconfig.json.",
  ),
  defineRepositoryRule(
    "repo.tsconfig",
    "typecheck-script",
    "Package family typecheck script",
    "Package family workspaces declare scripts.typecheck.",
    "A package-local typecheck entrypoint is required for targeted validation.",
    "Declare scripts.typecheck in the package manifest.",
  ),
]);
