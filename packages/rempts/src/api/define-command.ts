import type {
    CommandOptionsOutput,
    CommandOptionsRecord,
    EmptyCommandOptions,
    OptionInputSource,
} from "@reliverse/parser";
import type { RelicoInstance } from "@reliverse/relico";

import type { CommandTreeReport } from "../runtime/command-diagnostics";
import type { RemptsExitSignal } from "../runtime/errors";
import type { RemptsReservedOptionName } from "../runtime/global-flags";
import type { CommandInputAPI } from "../runtime/input";
import type { InteractionPolicy } from "../runtime/noninteractive";
import type { PluginDiscoveryReport } from "../runtime/plugin-discovery";
import type {
    ConfirmationMode,
    ParsedGlobalFlags,
    RemptsInteractionMode,
    RuntimeOutput,
    StdinMode,
} from "../runtime/types";

export const COMMAND_DEFINITION_KIND = "@reliverse/rempts/command";

export interface PromptInputOptions {
    readonly message?: string | undefined;
    readonly title?: string | undefined;
    readonly defaultValue?: string | undefined;
    readonly placeholder?: string | undefined;
    readonly required?: boolean | undefined;
}

export interface PromptConfirmOptions {
    readonly message?: string | undefined;
    readonly title?: string | undefined;
    readonly defaultValue?: boolean | undefined;
}

export interface PromptSelectOption<TValue extends string = string> {
    readonly label: string;
    readonly value: TValue;
    readonly description?: string | undefined;
}

export interface PromptSelectOptions<TValue extends string = string> {
    readonly message?: string | undefined;
    readonly title?: string | undefined;
    readonly options: ReadonlyArray<PromptSelectOption<TValue>>;
    readonly defaultValue?: TValue | undefined;
}

export interface CommandPromptAPI {
    input(options: PromptInputOptions): Promise<string>;
    confirm(options: PromptConfirmOptions): Promise<boolean>;
    select<TValue extends string>(
        options: PromptSelectOptions<TValue>,
    ): Promise<TValue>;
}

export interface CommandAgentMetadata {
    readonly notes?: string | undefined;
}

export type CommandEffect =
    | "fs.delete"
    | "fs.write"
    | "network.publish"
    | "package.install"
    | "process.exec"
    | (string & {});

export interface CommandSafety {
    /**
     * Preview means handlers should plan/report by default and execute mutations only when apply is true.
     */
    readonly defaultMode?: "preview" | "execute" | undefined;
    /**
     * Require an explicit --apply before handlers may execute declared side effects.
     */
    readonly requiresApply?: boolean | undefined;
    readonly effects?: ReadonlyArray<CommandEffect> | undefined;
}

export interface CommandSafetyAPI {
    readonly apply: boolean;
    readonly effects: readonly CommandEffect[];
    readonly preview: boolean;
    readonly requiresApply: boolean;
    assertApplied(
        effect?: CommandEffect | undefined,
        message?: string | undefined,
    ): void;
}

export interface CommandConventions {
    readonly acceptsStdin?: boolean | readonly OptionInputSource[] | undefined;
    readonly idempotent?: boolean | undefined;
    readonly supportsApply?: boolean | undefined;
    readonly supportsYes?: boolean | undefined;
}

export interface CommandRuntimeInfo<
    TOptions extends CommandOptionsRecord = EmptyCommandOptions,
> {
    readonly agent?: CommandAgentMetadata | undefined;
    readonly name: string;
    readonly path: readonly string[];
    readonly sourceId: string;
    readonly sourceKind: "file" | "plugin";
    readonly description?: string | undefined;
    readonly aliases: readonly string[];
    readonly conventions?: CommandConventions | undefined;
    readonly examples: readonly string[];
    readonly help?: string | undefined;
    readonly interactive: RemptsInteractionMode;
    readonly options?: TOptions | undefined;
    readonly safety?: CommandSafety | undefined;
    readonly filePath?: string | undefined;
    readonly directoryPath?: string | undefined;
}

export interface CommandContext<
    TOptions extends CommandOptionsRecord = EmptyCommandOptions,
> {
    readonly args: readonly string[];
    /** Plugin names discovered for `createCLI({ plugins })`, in precedence order. */
    readonly cliPluginNames: readonly string[];
    readonly cli?:
        | {
              readonly commandTree?: CommandTreeReport | undefined;
              readonly name: string;
              readonly pluginDiscovery?: PluginDiscoveryReport | undefined;
          }
        | undefined;
    readonly options: CommandOptionsOutput<TOptions>;
    readonly command: CommandRuntimeInfo<TOptions>;
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly stdin: typeof process.stdin;
    readonly stdout: typeof process.stdout;
    readonly stderr: typeof process.stderr;
    readonly isTTY: boolean;
    readonly isTUI: boolean;
    readonly globalFlags: ParsedGlobalFlags;
    readonly input: CommandInputAPI;
    readonly interaction: InteractionPolicy;
    readonly nonInteractive: boolean;
    readonly output: RuntimeOutput;
    readonly safety: CommandSafetyAPI;
    readonly colors: {
        readonly stderr: RelicoInstance;
        readonly stdout: RelicoInstance;
    };
    readonly confirmationMode: ConfirmationMode;
    readonly stdinMode: StdinMode;
    readonly prompt: CommandPromptAPI;
    out(...values: readonly unknown[]): void;
    err(...values: readonly unknown[]): void;
    exit(code?: number, message?: string): never;
}

export interface CommandConfig<
    TOptions extends CommandOptionsRecord = EmptyCommandOptions,
> {
    readonly agent?: CommandAgentMetadata | undefined;
    readonly meta?:
        | {
              readonly name?: string | undefined;
              readonly description?: string | undefined;
              readonly aliases?: ReadonlyArray<string> | undefined;
          }
        | undefined;
    readonly conventions?: CommandConventions | undefined;
    readonly safety?: CommandSafety | undefined;
    readonly help?:
        | {
              readonly text?: string | undefined;
              readonly examples?: ReadonlyArray<string> | undefined;
          }
        | undefined;
    readonly interactive?: RemptsInteractionMode | undefined;
    readonly options?: TOptions | undefined;
    readonly handler: (
        ctx: CommandContext<TOptions>,
    ) => Promise<unknown> | RemptsExitSignal | unknown;
}

export interface CommandDefinition<
    TOptions extends CommandOptionsRecord = EmptyCommandOptions,
> extends CommandConfig<TOptions> {
    readonly kind: typeof COMMAND_DEFINITION_KIND;
}

type RejectReservedOptionKeys<TOptions extends CommandOptionsRecord> =
    Extract<keyof TOptions, RemptsReservedOptionName> extends never
        ? unknown
        : {
              readonly __remptsReservedOptionNames__: Extract<
                  keyof TOptions,
                  RemptsReservedOptionName
              >;
          };

function normalizeCommandAliases(meta: CommandConfig["meta"]): string[] {
    const seen = new Set<string>();
    const aliases: string[] = [];
    const commandName = meta?.name;

    for (const rawAlias of meta?.aliases ?? []) {
        const alias = rawAlias.trim();

        if (alias.length === 0) {
            throw new TypeError("Command aliases must not be empty.");
        }

        if (alias.startsWith("-") || /\s/.test(alias)) {
            throw new TypeError(
                `Command alias "${alias}" must be a single command segment.`,
            );
        }

        if (commandName && alias === commandName) {
            throw new TypeError(
                `Command alias "${alias}" must not duplicate the command name.`,
            );
        }

        if (!seen.has(alias)) {
            seen.add(alias);
            aliases.push(alias);
        }
    }

    return aliases;
}

export function defineCommand<
    TOptions extends CommandOptionsRecord = EmptyCommandOptions,
>(
    config: CommandConfig<TOptions> & RejectReservedOptionKeys<TOptions>,
): CommandDefinition<TOptions> {
    const aliases = normalizeCommandAliases(config.meta);
    const examples = config.help?.examples ? [...config.help.examples] : [];

    return {
        ...config,
        meta: {
            ...config.meta,
            aliases,
        },
        help: {
            ...config.help,
            examples,
        },
        kind: COMMAND_DEFINITION_KIND,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is ReadonlyArray<string> {
    return (
        Array.isArray(value) && value.every((item) => typeof item === "string")
    );
}

export function isCommandDefinition(
    value: unknown,
): value is CommandDefinition<CommandOptionsRecord> {
    if (!isRecord(value)) {
        return false;
    }

    if (value.kind !== COMMAND_DEFINITION_KIND) {
        return false;
    }

    if (typeof value.handler !== "function") {
        return false;
    }

    if (
        value.meta !== undefined &&
        (!isRecord(value.meta) ||
            (value.meta.aliases !== undefined &&
                !isStringArray(value.meta.aliases)))
    ) {
        return false;
    }

    if (
        value.help !== undefined &&
        (!isRecord(value.help) ||
            (value.help.examples !== undefined &&
                !isStringArray(value.help.examples)))
    ) {
        return false;
    }

    return true;
}

export type { CommandInputAPI } from "../runtime/input";
