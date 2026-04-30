import { basename, extname } from "node:path";

import { detectTerminalSupport } from "@reliverse/myenv";
import {
  ParserUsageError,
  ParserValidationError,
  parseArgvTail,
  type CommandOptionDefinition,
  type CommandOptionsRecord,
  type ParseArgvResult,
} from "@reliverse/parser";
import { createRelico } from "@reliverse/relico";

import { createPromptRuntime } from "../prompts/adapter";
import { inspectCommandTree } from "../runtime/command-diagnostics";
import type { CommandNode } from "../runtime/command-source";
import { createCommandContext } from "../runtime/context";
import { discoverCommandPath } from "../runtime/discover-command";
import {
  PromptUnavailableError,
  RemptsUsageError,
  RemptsValidationError,
  toStructuredRemptsError,
} from "../runtime/errors";
import { executeCommand } from "../runtime/execute";
import { createFileCommandSource } from "../runtime/file-source";
import {
  assertNoReservedOptionCollisions,
  getGlobalFlagDefinitions,
  parseGlobalFlags,
  type GlobalFlagConfig,
} from "../runtime/global-flags";
import { serializeHelpDocument } from "../runtime/help-json";
import { buildCommandHelpDocument, buildLauncherHelpDocument } from "../runtime/help-model";
import { renderHelpDocument } from "../runtime/help-render";
import { createCommandInput } from "../runtime/input";
import { createRuntimeOutput } from "../runtime/output";
import { inspectPluginDiscovery, resolvePluginsFromReport } from "../runtime/plugin-discovery";
import { createPluginCommandSource } from "../runtime/plugin-source";
import { resolveEntry } from "../runtime/resolve-entry";
import { createCommandSafety } from "../runtime/safety";
import type {
  OutputMode,
  ParsedGlobalFlags,
  RemptsHostInteractionMode,
  RemptsInteractionMode,
} from "../runtime/types";
import type { CommandConventions, CommandRuntimeInfo, CommandSafety } from "./define-command";
import type { RemptsPlugin } from "./define-plugin";

type OutputStream = Pick<typeof process.stdout, "write">;

export interface CLIExecutionResult {
  readonly commandName?: string | undefined;
  readonly commandPath: readonly string[];
  readonly exitCode: number;
  readonly globalFlags: ParsedGlobalFlags;
  readonly isTTY: boolean;
  readonly isTUI: boolean;
  readonly ok: boolean;
  readonly outputMode: OutputMode;
}

export interface CreateCLIOptions {
  readonly entry: string;
  readonly argv?: readonly string[] | undefined;
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly globalFlags?: GlobalFlagConfig | undefined;
  readonly interactionMode?: RemptsHostInteractionMode | undefined;
  readonly onError?: ((error: unknown) => Promise<void> | void) | undefined;
  readonly onExit?: ((result: CLIExecutionResult) => Promise<void> | void) | undefined;
  readonly outputMode?: OutputMode | undefined;
  readonly meta?:
    | {
        readonly name?: string | undefined;
        readonly description?: string | undefined;
      }
    | undefined;
  readonly help?:
    | {
        readonly examples?: readonly string[] | undefined;
        readonly format?: "auto" | "json" | "text" | undefined;
      }
    | undefined;
  /**
   * Inherited option definitions applied to every command in this CLI, including plugin commands.
   * Command-level options override plugin-level options, which override these CLI-level options.
   */
  readonly options?: CommandOptionsRecord | undefined;
  /**
   * Plugin discovery configuration.
   *
   * When present, Rempts resolves plugins from the host package environment and optional
   * global CLI config. The end user controls which plugin packages are installed/configured;
   * the CLI controls which package names are allowed to participate.
   *
   * - `allowedPatterns`: required allowlist of plugin package name globs.
   * - `conflictPriority`: optional precedence rules for exact-node plugin conflicts.
   *   First matching rule wins; exact package names can be mixed with broader glob patterns.
   * - `cwd`: directory to start searching upward for the host package.json (defaults to CreateCLIOptions.cwd).
   */
  readonly plugins?:
    | {
        readonly allowedPatterns?: readonly string[] | undefined;
        readonly conflictPriority?: readonly string[] | undefined;
        readonly cwd?: string | undefined;
      }
    | undefined;
  readonly stderr?: typeof process.stderr | undefined;
  readonly stdin?: typeof process.stdin | undefined;
  readonly stdout?: typeof process.stdout | undefined;
}

function writeHelp(stream: OutputStream, helpText: string): void {
  stream.write(`\n${helpText}\n\n`);
}

function stripCLIExtension(cliName: string): string {
  const extension = extname(cliName);

  return extension ? basename(cliName, extension) : basename(cliName);
}

function getCLIName(
  entryFileName: string,
  explicitName: string | undefined,
  processArgv: readonly string[],
): string {
  if (explicitName) {
    return explicitName;
  }

  const invokedPath = processArgv[1];

  if (invokedPath) {
    return stripCLIExtension(invokedPath);
  }

  return basename(entryFileName, extname(entryFileName));
}

function getOutputMode(
  configuredMode: OutputMode | undefined,
  flags: ParsedGlobalFlags,
): OutputMode {
  if (flags.json) {
    return "json";
  }

  return configuredMode ?? "text";
}

function shouldRenderJsonHelp(
  helpFormat: "auto" | "json" | "text" | undefined,
  outputMode: OutputMode,
): boolean {
  if (helpFormat === "json") {
    return true;
  }

  if (helpFormat === "text") {
    return false;
  }

  return outputMode === "json";
}

function getResult(result: Omit<CLIExecutionResult, "ok">): CLIExecutionResult {
  return {
    ...result,
    ok: result.exitCode === 0,
  };
}

function assertNoPluginNameCollisions(plugins: readonly RemptsPlugin[]): void {
  const seen = new Set<string>();

  for (const plugin of plugins) {
    if (seen.has(plugin.name)) {
      throw new RemptsUsageError(
        [
          `Duplicate plugin name "${plugin.name}" detected.`,
          "",
          "Each plugin must have a unique internal `name`.",
          "Fix: rename one plugin's `definePlugin({ name })` value.",
        ].join("\n"),
        1,
      );
    }

    seen.add(plugin.name);
  }
}

function buildEmptyLauncherHelpText(options: {
  readonly commandRoot: string;
  readonly pluginDiscoveryEnabled: boolean;
}): string {
  const lines = [
    "No commands are currently available in this CLI.",
    "",
    "End user tips:",
    "- run this CLI inside the intended project/workspace",
    options.pluginDiscoveryEnabled
      ? "- install or enable the plugin packages expected by this CLI"
      : "- check whether this CLI exposes commands in your current install",
    "",
    "CLI developer tips:",
    `- add local command files under ${options.commandRoot}`,
  ];

  if (options.pluginDiscoveryEnabled) {
    lines.push(
      "- configure plugin discovery via createCLI({ plugins: { allowedPatterns: [...] } })",
      "- keep plugin discovery as an extension point, not as a hard requirement",
    );
  }

  return lines.join("\n");
}

async function finalizeResult(
  result: CLIExecutionResult,
  onExit: CreateCLIOptions["onExit"],
): Promise<CLIExecutionResult> {
  if (onExit) {
    await onExit(result);
  }

  return result;
}

const APPLY_OPTION_DEFINITION: CommandOptionDefinition = {
  type: "boolean",
  description: "Execute side effects. Default is preview-only for commands that require apply.",
  inputSources: ["flag"],
};

function withSafetyApplyOption(
  commandOptions: CommandOptionsRecord | undefined,
  definition: {
    readonly conventions?: CommandConventions | undefined;
    readonly safety?: CommandSafety | undefined;
  },
): CommandOptionsRecord | undefined {
  const requiresApply =
    definition.safety?.requiresApply === true || definition.conventions?.supportsApply === true;

  if (!requiresApply) {
    return commandOptions;
  }

  if (commandOptions?.apply) {
    return commandOptions;
  }

  return {
    ...(commandOptions ?? {}),
    apply: APPLY_OPTION_DEFINITION,
  };
}

function toCommandRuntimeInfo<TOptions extends CommandOptionsRecord>(
  commandName: string,
  commandNode: Pick<CommandNode, "directoryPath" | "filePath" | "sourceId" | "sourceKind">,
  commandPath: readonly string[],
  definition: {
    readonly agent?: { readonly notes?: string | undefined } | undefined;
    readonly meta?:
      | {
          readonly aliases?: readonly string[] | undefined;
          readonly description?: string | undefined;
        }
      | undefined;
    readonly conventions?: CommandConventions | undefined;
    readonly safety?: CommandSafety | undefined;
    readonly help?:
      | { readonly examples?: readonly string[] | undefined; readonly text?: string | undefined }
      | undefined;
    readonly interactive?: RemptsInteractionMode | undefined;
    readonly options?: TOptions | undefined;
  },
): CommandRuntimeInfo<TOptions> {
  return {
    agent: definition.agent,
    aliases: definition.meta?.aliases ?? [],
    conventions: definition.conventions,
    description: definition.meta?.description,
    directoryPath: commandNode.directoryPath,
    examples: definition.help?.examples ?? [],
    filePath: commandNode.filePath,
    help: definition.help?.text,
    interactive: definition.interactive ?? "never",
    name: commandName,
    options: definition.options,
    path: commandPath,
    safety: definition.safety,
    sourceId: commandNode.sourceId,
    sourceKind: commandNode.sourceKind,
  };
}

function mergeInheritedOptions(
  cliOptions: CommandOptionsRecord | undefined,
  pluginOptions: CommandOptionsRecord | undefined,
  commandOptions: CommandOptionsRecord | undefined,
): CommandOptionsRecord | undefined {
  const merged = {
    ...(cliOptions ?? {}),
    ...(pluginOptions ?? {}),
    ...(commandOptions ?? {}),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export async function createCLI(options: CreateCLIOptions): Promise<CLIExecutionResult> {
  const argv = options.argv ?? process.argv.slice(2);
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const parsedGlobals = parseGlobalFlags(argv, options.globalFlags);
  const outputMode = getOutputMode(options.outputMode, parsedGlobals.flags);
  const terminal = detectTerminalSupport({ stderr, stdout });
  const helpColors = {
    body: createRelico({ stream: "stdout" }),
    heading: createRelico({ stream: "stdout" }),
  };
  const renderJsonHelp = shouldRenderJsonHelp(options.help?.format, outputMode);
  const output = createRuntimeOutput({
    mode: outputMode,
    stderr,
    stdout,
  });

  try {
    const resolvedEntry = resolveEntry(options.entry);
    const globalFlagDefinitions = getGlobalFlagDefinitions(options.globalFlags);
    const cliName = getCLIName(resolvedEntry.entryFileName, options.meta?.name, process.argv);

    const allowedPatterns = options.plugins?.allowedPatterns ?? [];
    const conflictPriority = options.plugins?.conflictPriority ?? [];
    const pluginsCwd = options.plugins?.cwd ?? cwd;
    const pluginDiscoveryEnabled = options.plugins !== undefined;

    let effectivePlugins: readonly RemptsPlugin[] = [];
    let pluginDiscoveryReport = undefined;

    if (pluginDiscoveryEnabled) {
      pluginDiscoveryReport = await inspectPluginDiscovery({
        allowedPatterns,
        cliName,
        conflictPriority,
        cwd: pluginsCwd,
        entryDirectory: resolvedEntry.entryDirectory,
        entryFilePath: resolvedEntry.entryFilePath,
      });
      effectivePlugins = resolvePluginsFromReport(pluginDiscoveryReport);
    }

    assertNoPluginNameCollisions(effectivePlugins);

    const sources = [
      createFileCommandSource(resolvedEntry),
      ...effectivePlugins.map((plugin) => createPluginCommandSource(plugin)),
    ];
    const commandDiagnostics = await inspectCommandTree(sources);
    const discovered = await discoverCommandPath(sources, parsedGlobals.argv);

    if (!discovered.commandNode?.loadCommand) {
      const emptyCliHelpText =
        discovered.matchedPath.length === 0 && discovered.availableSubcommands.length === 0
          ? buildEmptyLauncherHelpText({
              commandRoot: resolvedEntry.commandRoot,
              pluginDiscoveryEnabled,
            })
          : undefined;
      const launcherHelp = buildLauncherHelpDocument({
        agentNotes: discovered.commandNode?.agent?.notes,
        availableSubcommands: discovered.availableSubcommands,
        commandPath: discovered.matchedPath,
        description:
          discovered.matchedPath.length > 0
            ? (discovered.commandNode?.description ??
              `Available subcommands for ${discovered.matchedPath.join(" ")}.`)
            : options.meta?.description,
        examples:
          discovered.matchedPath.length > 0
            ? discovered.commandNode?.examples
            : options.help?.examples,
        conventions: discovered.commandNode?.conventions,
        globalFlagDefinitions,
        helpText: discovered.commandNode?.help ?? emptyCliHelpText,
        interactive: discovered.commandNode?.interactive ?? "never",
        programName: cliName,
      });

      if (discovered.unknownSegment) {
        output.problem({
          ...toStructuredRemptsError(
            new RemptsUsageError(`Unknown command "${discovered.unknownSegment}".`, 1, {
              code: "REMPTS_UNKNOWN_COMMAND",
              hint: "Run --help to discover available commands.",
              usage: launcherHelp.usage[0],
            }),
          ),
        });

        if (!renderJsonHelp) {
          writeHelp(stderr, renderHelpDocument(launcherHelp, helpColors));
        }

        return finalizeResult(
          getResult({
            commandPath: discovered.matchedPath,
            exitCode: 1,
            globalFlags: parsedGlobals.flags,
            isTTY: Boolean(stdin.isTTY) && terminal.stdout.isTTY,
            isTUI: false,
            outputMode,
          }),
          options.onExit,
        );
      }

      if (renderJsonHelp) {
        output.data(serializeHelpDocument(launcherHelp));
      } else {
        writeHelp(stdout, renderHelpDocument(launcherHelp, helpColors));
      }

      return finalizeResult(
        getResult({
          commandPath: discovered.matchedPath,
          exitCode: parsedGlobals.flags.help || discovered.matchedPath.length === 0 ? 0 : 1,
          globalFlags: parsedGlobals.flags,
          isTTY: Boolean(stdin.isTTY) && terminal.stdout.isTTY,
          isTUI: false,
          outputMode,
        }),
        options.onExit,
      );
    }

    const resolvedCommandNode = discovered.commandNode;
    const loadCommand = resolvedCommandNode.loadCommand;

    if (!loadCommand) {
      throw new RemptsUsageError("Resolved command node is missing a command loader.", 1);
    }

    const command = await loadCommand();
    const owningPlugin =
      resolvedCommandNode.sourceKind === "plugin"
        ? effectivePlugins.find((plugin) => plugin.name === resolvedCommandNode.sourceId)
        : undefined;
    assertNoReservedOptionCollisions(options.options, {
      config: options.globalFlags,
      owner: "CLI inherited",
    });
    assertNoReservedOptionCollisions(owningPlugin?.options, {
      config: options.globalFlags,
      owner: owningPlugin ? `Plugin "${owningPlugin.name}"` : "Plugin",
    });
    assertNoReservedOptionCollisions(command.options, {
      config: options.globalFlags,
      owner: "Command",
    });

    const mergedCommandOptions = mergeInheritedOptions(
      options.options,
      owningPlugin?.options,
      command.options,
    );
    const effectiveCommandOptions = withSafetyApplyOption(mergedCommandOptions, command);
    const effectiveCommand = {
      ...command,
      options: effectiveCommandOptions,
    };

    const commandName = effectiveCommand.meta?.name ?? discovered.matchedPath.at(-1) ?? cliName;
    const commandHelp = buildCommandHelpDocument({
      availableSubcommands: discovered.availableSubcommands,
      command: effectiveCommand,
      commandPath: discovered.matchedPath,
      globalFlagDefinitions,
      programName: cliName,
    });

    if (parsedGlobals.flags.help) {
      if (renderJsonHelp) {
        output.data(serializeHelpDocument(commandHelp));
      } else {
        writeHelp(stdout, renderHelpDocument(commandHelp, helpColors));
      }

      return finalizeResult(
        getResult({
          commandName,
          commandPath: discovered.matchedPath,
          exitCode: 0,
          globalFlags: parsedGlobals.flags,
          isTTY: Boolean(stdin.isTTY) && terminal.stdout.isTTY,
          isTUI: false,
          outputMode,
        }),
        options.onExit,
      );
    }

    let parsed: ParseArgvResult<CommandOptionsRecord>;

    try {
      parsed = await parseArgvTail(discovered.remainingArgv, effectiveCommand.options, env);
    } catch (error) {
      if (
        error instanceof ParserUsageError ||
        error instanceof ParserValidationError ||
        error instanceof RemptsUsageError ||
        error instanceof RemptsValidationError
      ) {
        output.problem({
          ...toStructuredRemptsError(error),
          hint: `Run "${commandHelp.usage[0]} --help" for examples and flag details.`,
          relatedCommand: commandName,
          usage: commandHelp.usage[0],
        });

        return finalizeResult(
          getResult({
            commandName,
            commandPath: discovered.matchedPath,
            exitCode: error.exitCode,
            globalFlags: parsedGlobals.flags,
            isTTY: Boolean(stdin.isTTY) && terminal.stdout.isTTY,
            isTUI: false,
            outputMode,
          }),
          options.onExit,
        );
      }

      throw error;
    }

    const promptRuntime = await createPromptRuntime({
      commandMode: effectiveCommand.interactive,
      env,
      hostMode: options.interactionMode ?? "never",
      interactive: parsedGlobals.flags.interactive,
      noInput: parsedGlobals.flags.noInput,
      stderr,
      stdin,
      stdout,
      tui: parsedGlobals.flags.tui,
    });

    const safety = createCommandSafety({
      commandName,
      commandOptions: parsed.options,
      safety: effectiveCommand.safety,
    });

    const context = createCommandContext({
      args: parsed.args,
      cli: {
        commandTree: commandDiagnostics,
        name: cliName,
        pluginDiscovery: pluginDiscoveryReport,
      },
      cliPluginNames: effectivePlugins.map((plugin) => plugin.name),
      command: toCommandRuntimeInfo(
        commandName,
        resolvedCommandNode,
        discovered.matchedPath,
        effectiveCommand,
      ),
      confirmationMode: promptRuntime.confirmationMode,
      cwd,
      env,
      globalFlags: parsedGlobals.flags,
      input: createCommandInput({
        interaction: promptRuntime.interaction,
        stdin,
      }),
      interaction: promptRuntime.interaction,
      isTTY: promptRuntime.isTTY,
      isTUI: promptRuntime.isTUI,
      options: parsed.options,
      output,
      safety,
      stdinMode: promptRuntime.stdinMode,
      prompt: promptRuntime.prompt,
      stderr,
      stdin,
      stdout,
    });
    const execution = await executeCommand(effectiveCommand, context);

    if (execution.unexpectedError && options.onError) {
      await options.onError(execution.unexpectedError);
    }

    return finalizeResult(
      getResult({
        commandName,
        commandPath: discovered.matchedPath,
        exitCode: execution.exitCode,
        globalFlags: parsedGlobals.flags,
        isTTY: promptRuntime.isTTY,
        isTUI: promptRuntime.isTUI,
        outputMode,
      }),
      options.onExit,
    );
  } catch (error) {
    if (
      error instanceof RemptsUsageError ||
      error instanceof RemptsValidationError ||
      error instanceof PromptUnavailableError
    ) {
      output.problem(toStructuredRemptsError(error));
    } else {
      output.problem(toStructuredRemptsError(error));
    }

    if (options.onError) {
      await options.onError(error);
    }

    return finalizeResult(
      getResult({
        commandPath: [],
        exitCode: 1,
        globalFlags: parsedGlobals.flags,
        isTTY: Boolean(stdin.isTTY) && terminal.stdout.isTTY,
        isTUI: false,
        outputMode,
      }),
      options.onExit,
    );
  }
}
