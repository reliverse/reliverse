import { defineRepositoryRule } from "../shared/rules";

export const REPO_REMPTS_RULE_IDS = Object.freeze({
  pluginEntrypoint: "repo.rempts.plugin-entrypoint",
  pluginSurface: "repo.rempts.plugin-surface",
  pluginMount: "repo.rempts.plugin-mount",
  fileDiscovery: "repo.rempts.file-discovery",
  commandExport: "repo.rempts.command-export",
  relativeImport: "repo.rempts.relative-import",
  cliHost: "repo.rempts.cli-host",
  interactiveSurfaceOwnership: "repo.rempts.interactive-surface-ownership",
} as const);

export const REPO_REMPTS_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.rempts",
    "plugin-entrypoint",
    "Rempts plugin entrypoint",
    "Rse plugins contain exactly one Rempts plugin declaration.",
    "Rempts owns plugin identity and lifecycle through one declaration.",
    "Expose one definePlugin declaration from src/index.ts.",
  ),
  defineRepositoryRule(
    "repo.rempts",
    "plugin-surface",
    "Headless Rse plugin surface",
    "Rse plugins do not expose parallel executable entrypoints.",
    "Plugin commands are mounted by the Rempts host rather than a second CLI lifecycle.",
    "Remove plugin bin and ./cli exports.",
  ),
  defineRepositoryRule(
    "repo.rempts",
    "plugin-mount",
    "Plugin command mount",
    "Command-contributing Rse plugins declare their Rempts mount path.",
    "commands.mount gives file-discovered commands one explicit host composition point.",
    "Declare commands: { mount: [...] } in definePlugin.",
  ),
  defineRepositoryRule(
    "repo.rempts",
    "file-discovery",
    "Rempts file discovery",
    "CLI and plugin commands use file discovery without legacy manual registration.",
    "One discovery model prevents divergent command surfaces.",
    "Move commands to src/cmds and remove manual commands registration.",
  ),
  defineRepositoryRule(
    "repo.rempts",
    "command-export",
    "Command default export",
    "File-discovered command modules provide a default export.",
    "Rempts loads cmd modules through their default command declaration.",
    "Export the command declaration as default.",
  ),
  defineRepositoryRule(
    "repo.rempts",
    "relative-import",
    "Resolvable plugin imports",
    "Rse plugin relative source imports resolve within the repository.",
    "Broken relative imports prevent host discovery and loading.",
    "Correct the import or create the referenced module.",
  ),
  defineRepositoryRule(
    "repo.rempts",
    "interactive-surface-ownership",
    "Rempts interactive surface ownership",
    "Rempts-based command modules use ctx.prompt primitives instead of direct terminal input mechanics.",
    "One prompt authority keeps TTY, TUI, secret redaction, cancellation, and accessibility semantics aligned.",
    "Use ctx.prompt.text/secret/confirm/select/multiselect/path and keep raw terminal mechanics inside Rempts.",
  ),
  defineRepositoryRule(
    "repo.rempts",
    "cli-host",
    "Single Rempts CLI host",
    "Canonical CLIs use exactly one defineCLI declaration and do not define plugins.",
    "CLI and plugin lifecycles are distinct Rempts ownership boundaries.",
    "Mount one defineCLI host and move plugin declarations to extension packages.",
  ),
]);
