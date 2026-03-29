import { basename, extname } from "node:path";

import type { RemptsPlugin } from "./define-plugin";
import type { CommandConventions, CommandRuntimeInfo } from "./define-command";
import type { CommandOptionsRecord } from "../options/types";
import { createPromptRuntime } from "../prompts/adapter";
import type { CommandNode } from "../runtime/command-source";
import { createCommandContext } from "../runtime/context";
import { discoverCommandPath } from "../runtime/discover-command";
import { executeCommand } from "../runtime/execute";
import { createFileCommandSource } from "../runtime/file-source";
import {
  assertNoGlobalFlagCollisions,
  getGlobalFlagDefinitions,
  parseGlobalFlags,
  type GlobalFlagConfig,
} from "../runtime/global-flags";
import {
  buildCommandHelpDocument,
  buildLauncherHelpDocument,
} from "../runtime/help-model";
import { serializeHelpDocument } from "../runtime/help-json";
import { renderHelpDocument } from "../runtime/help-render";
import { createCommandInput } from "../runtime/input";
import { createRuntimeOutput } from "../runtime/output";
import { parseArgvTail, type ParseArgvResult } from "../runtime/parse-argv";
import { createPluginCommandSource } from "../runtime/plugin-source";
import {
  loadPluginsFromHostManifest,
  resolveHostPluginsFromDirectory,
} from "../runtime/host-plugins";
import { resolveEntry } from "../runtime/resolve-entry";
import type { OutputMode, ParsedGlobalFlags } from "../runtime/types";
import {
  PromptUnavailableError,
  RemptsUsageError,
  RemptsValidationError,
  toStructuredRemptsError,
} from "../runtime/errors";

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
  readonly description?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly examples?: readonly string[] | undefined;
  readonly globalFlags?: GlobalFlagConfig | undefined;
  readonly helpFormat?: "auto" | "json" | "text" | undefined;
  readonly name?: string | undefined;
  readonly noTTY?: boolean | undefined;
  readonly noTUI?: boolean | undefined;
  readonly onError?: ((error: unknown) => Promise<void> | void) | undefined;
  readonly onExit?: ((result: CLIExecutionResult) => Promise<void> | void) | undefined;
  readonly outputMode?: OutputMode | undefined;
  readonly plugins?: readonly RemptsPlugin[] | undefined;
  /**
   * When true, load plugins from host package manifests. Rempts first loads defaults near the CLI entry
   * by resolving the nearest package.json from `hostPluginsCwd` or `cwd`. Loaded host plugins are
   * listed before any explicit `plugins`.
   */
  readonly hostPlugins?: boolean | undefined;
  /**
   * Directory to start searching upward for the host manifest.
   * When unset: uses {@link CreateCLIOptions.cwd}.
   */
  readonly hostPluginsCwd?: string | undefined;
  readonly stderr?: typeof process.stderr | undefined;
  readonly stdin?: typeof process.stdin | undefined;
  readonly stdout?: typeof process.stdout | undefined;
}

function writeHelp(stream: OutputStream, helpText: string): void {
  stream.write(`${helpText}\n`);
}

function stripProgramExtension(programName: string): string {
  const extension = extname(programName);

  return extension ? basename(programName, extension) : basename(programName);
}

function getProgramName(
  entryFileName: string,
  explicitName: string | undefined,
  processArgv: readonly string[],
): string {
  if (explicitName) {
    return explicitName;
  }

  const invokedPath = processArgv[1];

  if (invokedPath) {
    return stripProgramExtension(invokedPath);
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
  helpFormat: CreateCLIOptions["helpFormat"],
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

function getResult(
  result: Omit<CLIExecutionResult, "ok">,
): CLIExecutionResult {
  return {
    ...result,
    ok: result.exitCode === 0,
  };
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

function toCommandRuntimeInfo<TOptions extends CommandOptionsRecord>(
  commandName: string,
  commandNode: Pick<CommandNode, "directoryPath" | "filePath" | "sourceId" | "sourceKind">,
  commandPath: readonly string[],
  definition: {
    readonly agent?: { readonly notes?: string | undefined } | undefined;
    readonly aliases?: readonly string[] | undefined;
    readonly conventions?: CommandConventions | undefined;
    readonly description?: string | undefined;
    readonly examples?: readonly string[] | undefined;
    readonly help?: string | undefined;
    readonly noTTY?: boolean | undefined;
    readonly noTUI?: boolean | undefined;
    readonly options?: TOptions | undefined;
  },
): CommandRuntimeInfo<TOptions> {
  return {
    agent: definition.agent,
    aliases: definition.aliases ?? [],
    conventions: definition.conventions,
    description: definition.description,
    directoryPath: commandNode.directoryPath,
    examples: definition.examples ?? [],
    filePath: commandNode.filePath,
    help: definition.help,
    name: commandName,
    noTTY: definition.noTTY ?? false,
    noTUI: definition.noTUI ?? false,
    options: definition.options,
    path: commandPath,
    sourceId: commandNode.sourceId,
    sourceKind: commandNode.sourceKind,
  };
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
  const renderJsonHelp = shouldRenderJsonHelp(options.helpFormat, outputMode);
  const output = createRuntimeOutput({
    mode: outputMode,
    stderr,
    stdout,
  });

  try {
    const resolvedEntry = resolveEntry(options.entry);
    const globalFlagDefinitions = getGlobalFlagDefinitions(options.globalFlags);
    const programName = getProgramName(
      resolvedEntry.entryFileName,
      options.name,
      process.argv,
    );

    let effectivePlugins: readonly RemptsPlugin[] = options.plugins ?? [];

    if (options.hostPlugins) {
      const staticPlugins = options.plugins ?? [];
      const hostSearchRoot = options.hostPluginsCwd ?? cwd;

      try {
        const { hostRoot, pluginSpecifiers } = await resolveHostPluginsFromDirectory(hostSearchRoot);

        if (hostRoot && pluginSpecifiers.length > 0) {
          const loadedHostPlugins = await loadPluginsFromHostManifest(hostRoot, pluginSpecifiers);
          effectivePlugins = [...loadedHostPlugins, ...staticPlugins];
        } else if (staticPlugins.length === 0) {
          throw new RemptsUsageError(
            [
              "No Rempts host plugins found. Add a non-empty list to the nearest package.json (search walks upward from cwd):",
              "",
              '  "rempts": { "plugins": ["@acme/my-rempts-plugin"] }',
              "",
              "The legacy `rse.plugins` key is still honored when `rempts.plugins` is absent.",
              `Search started from: ${hostSearchRoot}`,
            ].join("\n"),
            1,
            {
              hint: "Install plugin packages in the same project as that package.json, or pass explicit `plugins` to createCLI.",
            },
          );
        }
      } catch (error) {
        if (error instanceof RemptsUsageError) {
          throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new RemptsUsageError(`Failed to load Rempts host plugins: ${message}`, 1);
      }
    }

    const sources = [
      createFileCommandSource(resolvedEntry),
      ...effectivePlugins.map((plugin) => createPluginCommandSource(plugin)),
    ];
    const discovered = await discoverCommandPath(sources, parsedGlobals.argv);

    if (!discovered.commandNode?.loadCommand) {
      const launcherHelp = buildLauncherHelpDocument({
        agentNotes: discovered.commandNode?.agent?.notes,
        availableSubcommands: discovered.availableSubcommands,
        commandPath: discovered.matchedPath,
        description:
          discovered.matchedPath.length > 0
            ? discovered.commandNode?.description ??
              `Available subcommands for ${discovered.matchedPath.join(" ")}.`
            : options.description,
        examples:
          discovered.matchedPath.length > 0
            ? discovered.commandNode?.examples
            : options.examples,
        conventions: discovered.commandNode?.conventions,
        globalFlagDefinitions,
        helpText: discovered.commandNode?.help,
        programName,
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
          writeHelp(stderr, renderHelpDocument(launcherHelp));
        }

        return finalizeResult(
          getResult({
            commandPath: discovered.matchedPath,
            exitCode: 1,
            globalFlags: parsedGlobals.flags,
            isTTY: Boolean(stdin.isTTY && stdout.isTTY),
            isTUI: false,
            outputMode,
          }),
          options.onExit,
        );
      }

      if (renderJsonHelp) {
        output.data(serializeHelpDocument(launcherHelp));
      } else {
        writeHelp(stdout, renderHelpDocument(launcherHelp));
      }

      return finalizeResult(
        getResult({
          commandPath: discovered.matchedPath,
          exitCode: parsedGlobals.flags.help || discovered.matchedPath.length === 0 ? 0 : 1,
          globalFlags: parsedGlobals.flags,
          isTTY: Boolean(stdin.isTTY && stdout.isTTY),
          isTUI: false,
          outputMode,
        }),
        options.onExit,
      );
    }

    const command = await discovered.commandNode.loadCommand();
    assertNoGlobalFlagCollisions(command.options, options.globalFlags);
    const commandName =
      command.name ??
      discovered.matchedPath.at(-1) ??
      programName;
    const commandHelp = buildCommandHelpDocument({
      availableSubcommands: discovered.availableSubcommands,
      command,
      commandPath: discovered.matchedPath,
      globalFlagDefinitions,
      programName,
    });

    if (parsedGlobals.flags.help) {
      if (renderJsonHelp) {
        output.data(serializeHelpDocument(commandHelp));
      } else {
        writeHelp(stdout, renderHelpDocument(commandHelp));
      }

      return finalizeResult(
        getResult({
          commandName,
          commandPath: discovered.matchedPath,
          exitCode: 0,
          globalFlags: parsedGlobals.flags,
          isTTY: Boolean(stdin.isTTY && stdout.isTTY),
          isTUI: false,
          outputMode,
        }),
        options.onExit,
      );
    }

    let parsed: ParseArgvResult<CommandOptionsRecord>;

    try {
      parsed = await parseArgvTail(discovered.remainingArgv, command.options);
    } catch (error) {
      if (error instanceof RemptsUsageError || error instanceof RemptsValidationError) {
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
            isTTY: Boolean(stdin.isTTY && stdout.isTTY),
            isTUI: false,
            outputMode,
          }),
          options.onExit,
        );
      }

      throw error;
    }

    const promptRuntime = await createPromptRuntime({
      env,
      noInput: parsedGlobals.flags.noInput,
      noTTY: options.noTTY || command.noTTY,
      noTUI: options.noTTY || command.noTTY || options.noTUI || command.noTUI,
      stderr,
      stdin,
      stdout,
    });

    const context = createCommandContext({
      args: parsed.args,
      cliPluginIds: effectivePlugins.map((plugin) => plugin.id),
      command: toCommandRuntimeInfo(
        commandName,
        discovered.commandNode,
        discovered.matchedPath,
        command,
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
      stdinMode: promptRuntime.stdinMode,
      prompt: promptRuntime.prompt,
      stderr,
      stdin,
      stdout,
    });
    const execution = await executeCommand(command, context);

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
        isTTY: Boolean(stdin.isTTY && stdout.isTTY),
        isTUI: false,
        outputMode,
      }),
      options.onExit,
    );
  }
}
