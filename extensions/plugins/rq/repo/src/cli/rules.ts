import { defineRepositoryRule } from "../shared/rules";

export const REPO_CLI_RULE_IDS = Object.freeze({
  packageIdentity: "repo.cli.package-identity",
  remptsHost: "repo.cli.rempts-host",
  binaryEntrypoint: "repo.cli.binary-entrypoint",
  rootScript: "repo.cli.root-script",
  shebang: "repo.cli.shebang",
  commandRoot: "repo.cli.command-root",
  remptsSourceNative: "repo.cli.rempts-source-native",
} as const);

export const REPO_CLI_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.cli",
    "package-identity",
    "CLI package identity",
    "Canonical CLI hosts use their declared package identities.",
    "CLI package identity is part of executable discovery and ownership.",
    "Align the CLI package name with its host inventory.",
  ),
  defineRepositoryRule(
    "repo.cli",
    "rempts-host",
    "Rempts CLI host",
    "Every first-party application under apps/cli is a thin Rempts host.",
    "A shared host runtime keeps command discovery, output, safety, and agent-facing contracts consistent.",
    "Depend on @reliverse/rempts and expose commands through the file-discovered src/cmds tree.",
  ),
  defineRepositoryRule(
    "repo.cli",
    "binary-entrypoint",
    "CLI binary entrypoint",
    "CLI packages expose their executable through src/cli.ts.",
    "A stable bin entry keeps package and direct invocation aligned.",
    "Set bin.<cli> to ./src/cli.ts.",
  ),
  defineRepositoryRule(
    "repo.cli",
    "root-script",
    "Root CLI script",
    "The repository root exposes each canonical CLI entrypoint.",
    "Root scripts are the repository-local invocation surface.",
    "Add or correct the root package script.",
  ),
  defineRepositoryRule(
    "repo.cli",
    "shebang",
    "CLI Bun shebang",
    "CLI entrypoints declare the Bun interpreter.",
    "Published and direct source executables require an explicit interpreter.",
    "Start src/cli.ts with #!/usr/bin/env bun.",
  ),
  defineRepositoryRule(
    "repo.cli",
    "command-root",
    "CLI command root",
    "File-discovered CLI hosts contain src/cmds.",
    "Rempts discovers command modules from the command root.",
    "Create the command root and its command modules.",
  ),
  defineRepositoryRule(
    "repo.cli",
    "rempts-source-native",
    "Source-native Rempts host",
    "Rempts CLI hosts run authored source without a generated runtime-profile prerequisite.",
    "Generated runtime glue is an artifact concern owned by Dler, not authored CLI source authority.",
    "Remove generated Rempts runtime profiles and profile-generation scripts from the normal CLI lifecycle.",
  ),
]);
