import type { CommandConventions, CommandDefinition } from "../api/define-command";
import { toFlagName } from "../options/flag-name";
import type { CommandOptionsRecord } from "../options/types";
import type { DiscoveredSubcommand } from "./command-source";
import type { GlobalFlagDefinition } from "./global-flags";

export interface HelpFlagItem {
  readonly defaultValue?: string | undefined;
  readonly description: string;
  readonly env?: string | undefined;
  readonly hint?: string | undefined;
  readonly inputSources?: readonly string[] | undefined;
  readonly names: string;
  readonly required?: boolean | undefined;
}

export interface HelpSubcommandItem {
  readonly description?: string | undefined;
  readonly name: string;
}

export interface HelpDocument {
  readonly aliases: readonly string[];
  readonly agentNotes?: string | undefined;
  readonly commandFlags: readonly HelpFlagItem[];
  readonly commandPath: readonly string[];
  readonly conventions?: CommandConventions | undefined;
  readonly description?: string | undefined;
  readonly examples: readonly string[];
  readonly globalFlags: readonly HelpFlagItem[];
  readonly helpText?: string | undefined;
  readonly programName: string;
  readonly scope: "command" | "launcher";
  readonly scopeLabel: string;
  readonly subcommands: readonly HelpSubcommandItem[];
  readonly usage: readonly string[];
}

function formatOptionPlaceholder(type: string): string {
  if (type === "boolean") {
    return "";
  }

  return type === "number" ? " <number>" : " <value>";
}

function toGlobalFlagItem(definition: GlobalFlagDefinition): HelpFlagItem {
  const shortPrefix = definition.shortName ? `-${definition.shortName}, ` : "";

  return {
    description: definition.description,
    hint: undefined,
    inputSources: ["flag"],
    names: `${shortPrefix}--${definition.longName}`,
  };
}

function toCommandFlagItems(
  optionDefinitions: CommandOptionsRecord | undefined,
): readonly HelpFlagItem[] {
  if (!optionDefinitions) {
    return [];
  }

  return Object.entries(optionDefinitions).map(([optionName, definition]) => {
    const flagName = toFlagName(optionName);
    const shortPrefix = definition.short ? `-${definition.short}, ` : "";
    const negationHint = definition.type === "boolean" ? `, --no-${flagName}` : "";
    const defaultValue =
      definition.defaultValue !== undefined ? String(definition.defaultValue) : undefined;

    return {
      defaultValue,
      description: definition.description ?? "No description",
      env: definition.env,
      hint: definition.hint,
      inputSources: definition.inputSources,
      names: `${shortPrefix}--${flagName}${formatOptionPlaceholder(definition.type)}${negationHint}`,
      required: definition.required,
    };
  });
}

function toSubcommandItems(
  subcommands: readonly DiscoveredSubcommand[],
): readonly HelpSubcommandItem[] {
  return subcommands.map((subcommand) => ({
    description: subcommand.description,
    name: subcommand.name,
  }));
}

export function buildLauncherHelpDocument(options: {
  readonly agentNotes?: string | undefined;
  readonly availableSubcommands: readonly DiscoveredSubcommand[];
  readonly commandPath: readonly string[];
  readonly conventions?: CommandConventions | undefined;
  readonly description?: string | undefined;
  readonly examples?: readonly string[] | undefined;
  readonly globalFlagDefinitions: readonly GlobalFlagDefinition[];
  readonly helpText?: string | undefined;
  readonly programName: string;
}): HelpDocument {
  const usage =
    options.commandPath.length > 0
      ? [`${options.programName} ${options.commandPath.join(" ")} <subcommand> [command-flags]`]
      : [`${options.programName} [global-flags] <command> [command-flags]`];

  return {
    aliases: [],
    agentNotes: options.agentNotes,
    commandFlags: [],
    commandPath: options.commandPath,
    conventions: options.conventions,
    description: options.description,
    examples: options.examples ?? [],
    globalFlags: options.globalFlagDefinitions.map(toGlobalFlagItem),
    helpText: options.helpText,
    programName: options.programName,
    scope: "launcher",
    scopeLabel: options.commandPath.length > 0 ? "Subcommands" : "Commands",
    subcommands: toSubcommandItems(options.availableSubcommands),
    usage,
  };
}

export function buildCommandHelpDocument<TOptions extends CommandOptionsRecord>(options: {
  readonly availableSubcommands: readonly DiscoveredSubcommand[];
  readonly command: CommandDefinition<TOptions>;
  readonly commandPath: readonly string[];
  readonly globalFlagDefinitions: readonly GlobalFlagDefinition[];
  readonly programName: string;
}): HelpDocument {
  const invocationPath =
    options.commandPath.length > 0
      ? `${options.programName} ${options.commandPath.join(" ")}`
      : options.programName;

  return {
    aliases: options.command.aliases ?? [],
    agentNotes: options.command.agent?.notes,
    commandFlags: toCommandFlagItems(options.command.options),
    commandPath: options.commandPath,
    conventions: options.command.conventions
      ? {
          acceptsStdin:
            options.command.conventions.acceptsStdin === true
              ? ["stdin"]
              : options.command.conventions.acceptsStdin,
          idempotent: options.command.conventions.idempotent,
          supportsDryRun: options.command.conventions.supportsDryRun,
          supportsForce: options.command.conventions.supportsForce,
          supportsYes: options.command.conventions.supportsYes,
        }
      : undefined,
    description: options.command.description,
    examples: options.command.examples ?? [],
    globalFlags: options.globalFlagDefinitions.map(toGlobalFlagItem),
    helpText: options.command.help,
    programName: options.programName,
    scope: "command",
    scopeLabel: "Subcommands",
    subcommands: toSubcommandItems(options.availableSubcommands),
    usage: [`${invocationPath} [global-flags] [command-flags] [args]`],
  };
}
