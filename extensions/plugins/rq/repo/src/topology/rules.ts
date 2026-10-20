import { defineRepositoryRule } from "../shared/rules";

export const REPO_TOPOLOGY_RULE_IDS = Object.freeze({
  configInsideRoot: "repo.topology.config-inside-root",
  configExists: "repo.topology.config-exists",
  projectRegistered: "repo.topology.project-registered",
} as const);

export const REPO_TOPOLOGY_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.topology",
    "config-inside-root",
    "Repository-local typecheck projects",
    "Workspace typecheck scripts reference configs inside the repository.",
    "Typecheck topology must be reproducible from repository-owned project files.",
    "Point the typecheck script at a repository-local tsconfig.",
  ),
  defineRepositoryRule(
    "repo.topology",
    "config-exists",
    "Existing typecheck project",
    "Workspace typecheck scripts reference existing project configs.",
    "A missing project path makes the package typecheck contract non-executable.",
    "Create or correct the referenced tsconfig.",
  ),
  defineRepositoryRule(
    "repo.topology",
    "project-registered",
    "Registered typecheck project",
    "Every package typecheck project belongs to the repository project inventory.",
    "The full typecheck graph must discover every project referenced by package scripts.",
    "Register the project or correct the package typecheck script.",
  ),
]);
