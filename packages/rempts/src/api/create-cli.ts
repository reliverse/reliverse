import { basename, extname } from "node:path";
import { detectTerminalSupport } from "@reliverse/myenv";

import type { RemptsPlugin } from "./define-plugin";
import type { CommandConventions, CommandRuntimeInfo } from "./define-command";
import type { CommandOptionsRecord } from "../options/types";
import { createPromptRuntime } from "../prompts/adapter";
import { createRelico } from "@reliverse/relico";
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
  getBunGlobalNodeModulesDirectory,
  isBunGlobalEntryPath,
  loadPluginsFromHostManifest,
  resolveHostPluginsFromDirectory,
} from "../runtime/host-plugins";
import {
  getDefaultRemptsGlobalConfigPath,
  readGlobalRemptsConfig,
  readGlobalHostPluginSpecifiers,
} from "../runtime/global-plugin-config";
import { resolveEntry } from "../runtime/resolve-entry";
import type {
  OutputMode,
  ParsedGlobalFlags,
  RemptsHostInteractionMode,
  RemptsInteractionMode,
} from "../runtime/types";
import {
  PromptUnavailableError,
  RemptsUsageError,
  RemptsValidationError,
  toStructuredRemptsError,
} from "../runtime/errors";

type OutputStream = Pick<typeof process.stdout, "write">;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(glob: string): RegExp {
  // Minimal glob: supports "*" only (no "**", no braces). Good enough for allowlists.
  const pattern = `^${glob.split("*").map(escapeRegExp).join(".*")}$`;
  return new RegExp(pattern);
}

function matchesAnyGlob(value: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

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
  readonly noTTY?: boolean | undefined;
  readonly noTUI?: boolean | undefined;
  readonly onError?: ((error: unknown) => Promise<void> | void) | undefined;
  readonly onExit?: ((result: CLIExecutionResult) => Promise<void> | void) | undefined;
  readonly outputMode?: OutputMode | undefined;
  readonly meta?: {
    readonly name?: string | undefined;
    readonly description?: string | undefined;
  } | undefined;
  readonly help?: {
    readonly examples?: readonly string[] | undefined;
    readonly format?: "auto" | "json" | "text" | undefined;
  } | undefined;
  /**
   * Plugin loading configuration.
   *
   * - `supportPlugins`: enable auto-discovery from the host package environment.
   * - `allowedPatterns`: optional allowlist of package name globs applied to auto-discovery candidates.
   * - `cwd`: directory to start searching upward for the host package.json (defaults to CreateCLIOptions.cwd).
   *
   * Note: explicit plugins should be passed via `explicit`.
   */
  readonly plugins?: {
    readonly explicit?: readonly RemptsPlugin[] | undefined;
    readonly supportPlugins?: boolean | undefined;
    readonly allowedPatterns?: readonly string[] | undefined;
    readonly cwd?: string | undefined;
  } | undefined;
  readonly stderr?: typeof process.stderr | undefined;
  readonly stdin?: typeof process.stdin | undefined;
  readonly stdout?: typeof process.stdout | undefined;
}

function writeHelp(stream: OutputStream, helpText: string): void {
  stream.write(`${helpText}\n`);
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

function getResult(
  result: Omit<CLIExecutionResult, "ok">,
): CLIExecutionResult {
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
          `Duplicate plugin name \"${plugin.name}\" detected.`,
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
    readonly meta?: { readonly aliases?: readonly string[] | undefined; readonly description?: string | undefined } | undefined;
    readonly conventions?: CommandConventions | undefined;
    readonly help?: { readonly examples?: readonly string[] | undefined; readonly text?: string | undefined } | undefined;
    readonly interactive?: RemptsInteractionMode | undefined;
    readonly noTTY?: boolean | undefined;
    readonly noTUI?: boolean | undefined;
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
    const cliName = getCLIName(
      resolvedEntry.entryFileName,
      options.meta?.name,
      process.argv,
    );

    const explicitPlugins = options.plugins?.explicit ?? [];
    const supportPlugins = options.plugins?.supportPlugins ?? false;
    const allowedPatterns = options.plugins?.allowedPatterns ?? [];
    const pluginsCwd = options.plugins?.cwd ?? cwd;

    let effectivePlugins: readonly RemptsPlugin[] = explicitPlugins;

    if (supportPlugins) {
      if (allowedPatterns.length === 0) {
        throw new RemptsUsageError(
          [
            "supportPlugins is enabled, but plugins.allowedPatterns is empty.",
            "",
            "Rempts runs supportPlugins in strict mode. Scanning all dependencies/devDependencies is not supported",
            "because most dependencies are not plugins and would fail strict validation.",
            "",
            "Fix: provide an allowlist of plugin package globs, e.g.:",
            '  plugins: { supportPlugins: true, allowedPatterns: ["@reliverse/*-rse-plugin"] }',
            "",
            "Alternatively, configure global host plugins:",
            `  ${getDefaultRemptsGlobalConfigPath()}`,
          ].join("\n"),
          1,
        );
      }

      const globalConfig = await readGlobalRemptsConfig();
      const bunInstallRoot = globalConfig?.bunInstallRoot;
      const bunGlobalNodeModules = getBunGlobalNodeModulesDirectory(bunInstallRoot);
      const globalEntry = isBunGlobalEntryPath(resolvedEntry.entryFilePath, bunInstallRoot);
      const hostSearchRoot = globalEntry ? resolvedEntry.entryDirectory : pluginsCwd;

      try {
        const { hostRoot, pluginSpecifiers } = await resolveHostPluginsFromDirectory(hostSearchRoot);
        const hostCandidates = hostRoot
          ? pluginSpecifiers.filter((name) => matchesAnyGlob(name, allowedPatterns))
          : [];
        const loadedHostPlugins =
          hostRoot && hostCandidates.length > 0
            ? await loadPluginsFromHostManifest(hostRoot, hostCandidates, {
                resolvePaths: globalEntry ? [bunGlobalNodeModules] : undefined,
              })
            : [];

        const globalConfigSpecifiers =
          loadedHostPlugins.length > 0 ? [] : await readGlobalHostPluginSpecifiers(cliName);
        const globalRejectedByPattern =
          allowedPatterns.length > 0
            ? globalConfigSpecifiers.filter((name) => !matchesAnyGlob(name, allowedPatterns))
            : [];
        if (globalRejectedByPattern.length > 0) {
          throw new RemptsUsageError(
            [
              "Global plugin config contains entries that are not allowed by this CLI's allowedPatterns.",
              "",
              `Config: ${getDefaultRemptsGlobalConfigPath()}`,
              `CLI: ${cliName}`,
              "",
              "Not allowed:",
              ...globalRejectedByPattern.map((name) => `- ${name}`),
              "",
              "Fix: remove these entries or adjust plugins.allowedPatterns in the CLI.",
            ].join("\n"),
            1,
          );
        }
        const allowedGlobalSpecifiers =
          allowedPatterns.length > 0
            ? globalConfigSpecifiers.filter((name) => matchesAnyGlob(name, allowedPatterns))
            : globalConfigSpecifiers;

        const loadedGlobalPlugins =
          allowedGlobalSpecifiers.length > 0
            ? await loadPluginsFromHostManifest(hostRoot ?? hostSearchRoot, allowedGlobalSpecifiers, {
                // Global config is meant for global installs too, so always allow Bun global resolution.
                resolvePaths: [bunGlobalNodeModules],
              })
            : [];

        if (loadedHostPlugins.length > 0 || loadedGlobalPlugins.length > 0) {
          effectivePlugins = [...loadedHostPlugins, ...explicitPlugins];
          if (loadedGlobalPlugins.length > 0) {
            effectivePlugins = [...loadedGlobalPlugins, ...effectivePlugins];
          }
        } else if (explicitPlugins.length === 0) {
          throw new RemptsUsageError(
            [
              "No Rempts host plugins found.",
              "",
              "For local development, install plugins as dependencies/devDependencies in the nearest package.json.",
              "",
              "For global usage, configure global host plugins:",
              "",
              `  ${getDefaultRemptsGlobalConfigPath()}`,
              `Search started from: ${hostSearchRoot}`,
            ].join("\n"),
            1,
            {
              hint: "Install plugin packages in your project (deps/devDeps), or configure global host plugins, or pass explicit plugins to createCLI({ plugins: { explicit: [...] } }).",
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

    assertNoPluginNameCollisions(effectivePlugins);

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
                : options.meta?.description,
        examples:
          discovered.matchedPath.length > 0
            ? discovered.commandNode?.examples
                : options.help?.examples,
        conventions: discovered.commandNode?.conventions,
        globalFlagDefinitions,
        helpText: discovered.commandNode?.help,
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

    const command = await discovered.commandNode.loadCommand();
    assertNoGlobalFlagCollisions(command.options, options.globalFlags);
    const commandName =
      command.meta?.name ??
      discovered.matchedPath.at(-1) ??
      cliName;
    const commandHelp = buildCommandHelpDocument({
      availableSubcommands: discovered.availableSubcommands,
      command,
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
      commandMode: command.interactive,
      env,
      hostMode: options.interactionMode ?? "never",
      interactive: parsedGlobals.flags.interactive,
      noInput: parsedGlobals.flags.noInput,
      noTTY: options.noTTY || command.noTTY,
      noTUI: options.noTTY || command.noTTY || options.noTUI || command.noTUI,
      stderr,
      stdin,
      stdout,
      tui: parsedGlobals.flags.tui,
    });

    const context = createCommandContext({
      args: parsed.args,
      cliPluginNames: effectivePlugins.map((plugin) => plugin.name),
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
        isTTY: Boolean(stdin.isTTY) && terminal.stdout.isTTY,
        isTUI: false,
        outputMode,
      }),
      options.onExit,
    );
  }
}
