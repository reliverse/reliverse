import { defineRepositoryRule } from "../shared/rules";

export const REPO_BOUNDARY_RULE_IDS = Object.freeze({
  relativeWorkspaceImport: "repo.boundaries.relative-workspace-import",
  typescriptExtension: "repo.boundaries.typescript-extension",
} as const);

export const REPO_BOUNDARY_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.boundaries",
    "relative-workspace-import",
    "Package boundary imports",
    "Workspace packages do not import another workspace through relative source paths.",
    "Cross-package source imports bypass package exports and dependency declarations.",
    "Import the target workspace through its package identity.",
  ),
  defineRepositoryRule(
    "repo.boundaries",
    "typescript-extension",
    "Portable module specifiers",
    "Module specifiers omit TypeScript source extensions.",
    "Published and runtime module resolution must not depend on TypeScript-only source suffixes.",
    "Remove the TypeScript extension from the module specifier.",
  ),
]);
