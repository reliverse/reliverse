export { createCLI, type CLIExecutionResult, type CreateCLIOptions } from "./api/create-cli";
export {
  findHostPluginPackageRoot,
  inspectPluginsFromHostManifest,
  loadPluginsFromHostManifest,
  parseHostPluginSpecifier,
  readHostPluginSpecifiers,
  resolveHostPluginsFromDirectory,
  type HostPluginLoadIssue,
  type HostPluginLoadSuccess,
  type InspectPluginsFromHostManifestResult,
  type ResolveHostPluginsResult,
} from "./runtime/host-plugins";
export { REMPTS_PLUGIN_API_VERSION, definePlugin, type RemptsPlugin } from "./api/define-plugin";
export {
  inspectCommandTree,
  type CommandCandidate,
  type CommandSubcommandDiagnostic,
  type CommandTreeNodeDiagnostic,
  type CommandTreeReport,
} from "./runtime/command-diagnostics";
export {
  inspectPluginDiscovery,
  matchConflictPriorityRule,
  matchesAnyGlob,
  resolveDiscoveredPlugins,
  resolvePluginsFromReport,
  type PluginDiscoveryLoadedPlugin,
  type PluginDiscoveryIgnoredSpecifier,
  type PluginDiscoveryRejectedPlugin,
  type PluginDiscoveryReport,
  type ResolveDiscoveredPluginsOptions,
} from "./runtime/plugin-discovery";
export {
  COMMAND_DEFINITION_KIND,
  defineCommand,
  isCommandDefinition,
  type CommandAgentMetadata,
  type CommandConfig,
  type CommandContext,
  type CommandConventions,
  type CommandDefinition,
  type CommandEffect,
  type CommandSafety,
  type CommandSafetyAPI,
  type CommandInputAPI,
  type CommandPromptAPI,
  type CommandRuntimeInfo,
  type PromptConfirmOptions,
  type PromptInputOptions,
  type PromptSelectOption,
  type PromptSelectOptions,
} from "./api/define-command";
export {
  confirmPrompt,
  createPromptRuntime,
  inputPrompt,
  selectPrompt,
  type PromptRuntimeOptions,
  type ResolvedPromptRuntime,
} from "./prompts/adapter";
export { serializeHelpDocument, type HelpDocument } from "./runtime/help";
export type {
  CommandOptionDefinition,
  OptionInputSource,
  CommandOptionsOutput,
  CommandOptionsRecord,
  CommandOptionType,
  EmptyCommandOptions,
} from "@reliverse/parser";
export type {
  ConfirmationMode,
  OutputMode,
  ParsedGlobalFlags,
  RemptsErrorKind,
  RuntimeOutput,
  StdinMode,
  StructuredRemptsError,
  StructuredRemptsResult,
} from "./runtime/types";
export type { InteractionPolicy } from "./runtime/noninteractive";
export type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
  StandardTypedV1,
} from "./types/standard-schema";
