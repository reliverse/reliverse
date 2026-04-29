import { toFlagName } from "../options/flag-name";
import type { CommandOptionsRecord } from "../options/types";
import { RemptsUsageError } from "./errors";
import type { ParsedGlobalFlags } from "./types";

export type GlobalFlagKey = keyof ParsedGlobalFlags;

export type RemptsReservedOptionName = GlobalFlagKey | "apply" | "no-input";

export interface GlobalFlagConfig {
  readonly help?: boolean | undefined;
  readonly interactive?: boolean | undefined;
  readonly json?: boolean | undefined;
  readonly noInput?: boolean | undefined;
  readonly tui?: boolean | undefined;
}

export interface GlobalFlagDefinition {
  readonly description: string;
  readonly enabled: boolean;
  readonly key: GlobalFlagKey;
  readonly longName: string;
  readonly shortName?: string | undefined;
}

export interface ParsedGlobalFlagsResult {
  readonly argv: readonly string[];
  readonly flags: ParsedGlobalFlags;
}

interface MutableGlobalFlags {
  help: boolean;
  interactive: boolean;
  json: boolean;
  noInput: boolean;
  tui: boolean;
}

const DEFAULT_GLOBAL_FLAGS: Readonly<Record<GlobalFlagKey, Omit<GlobalFlagDefinition, "enabled">>> =
  {
    help: {
      description: "Show help",
      key: "help",
      longName: "help",
      shortName: "h",
    },
    interactive: {
      description: "Allow plain interactive prompts when the command supports them",
      key: "interactive",
      longName: "interactive",
      shortName: "i",
    },
    json: {
      description: "Emit machine-readable JSON help, results, and errors",
      key: "json",
      longName: "json",
    },
    noInput: {
      description: "Disable interactive input and fail fast when required values are missing",
      key: "noInput",
      longName: "no-input",
    },
    tui: {
      description: "Allow TUI prompts when the command supports them",
      key: "tui",
      longName: "tui",
    },
  };

function isFlagEnabled(key: GlobalFlagKey, config: GlobalFlagConfig | undefined): boolean {
  const configuredValue = config?.[key];

  return configuredValue !== false;
}

export function getGlobalFlagDefinitions(
  config?: GlobalFlagConfig,
): readonly GlobalFlagDefinition[] {
  return (Object.keys(DEFAULT_GLOBAL_FLAGS) as GlobalFlagKey[])
    .map((key) => ({
      ...DEFAULT_GLOBAL_FLAGS[key],
      enabled: isFlagEnabled(key, config),
    }))
    .filter((definition) => definition.enabled);
}

export function parseGlobalFlags(
  argv: readonly string[],
  config?: GlobalFlagConfig,
): ParsedGlobalFlagsResult {
  const enabledDefinitions = getGlobalFlagDefinitions(config);
  const byLongName = new Map<string, GlobalFlagDefinition>();
  const byShortName = new Map<string, GlobalFlagDefinition>();
  const remainingArgv: string[] = [];
  let consumePositionalsOnly = false;

  const flags: MutableGlobalFlags = {
    help: false,
    interactive: false,
    json: false,
    noInput: false,
    tui: false,
  };

  for (const definition of enabledDefinitions) {
    byLongName.set(definition.longName, definition);

    if (definition.shortName) {
      byShortName.set(definition.shortName, definition);
    }
  }

  for (const token of argv) {
    if (consumePositionalsOnly) {
      remainingArgv.push(token);
      continue;
    }

    if (token === "--") {
      consumePositionalsOnly = true;
      remainingArgv.push(token);
      continue;
    }

    if (token.startsWith("--")) {
      const longName = token.slice(2);
      const definition = byLongName.get(longName);

      if (definition) {
        flags[definition.key] = true;
        continue;
      }
    }

    if (token.startsWith("-") && token.length === 2) {
      const shortName = token.slice(1);
      const definition = byShortName.get(shortName);

      if (definition) {
        flags[definition.key] = true;
        continue;
      }
    }

    remainingArgv.push(token);
  }

  return {
    argv: remainingArgv,
    flags,
  };
}

const RESERVED_RUNTIME_OPTION_LONG_NAMES = ["apply"] as const;

export function getReservedOptionLongNames(): readonly string[] {
  return [
    ...Object.values(DEFAULT_GLOBAL_FLAGS).map((definition) => definition.longName),
    ...RESERVED_RUNTIME_OPTION_LONG_NAMES,
  ];
}

export function assertNoReservedOptionCollisions(
  optionDefinitions: CommandOptionsRecord | undefined,
  options?: {
    readonly config?: GlobalFlagConfig | undefined;
    readonly owner?: string | undefined;
  },
): void {
  if (!optionDefinitions) {
    return;
  }

  const enabledGlobalFlags = getGlobalFlagDefinitions(options?.config);
  const reservedLongNames = new Set([
    ...enabledGlobalFlags.map((definition) => definition.longName),
    ...RESERVED_RUNTIME_OPTION_LONG_NAMES,
  ]);
  const reservedShortNames = new Map(
    enabledGlobalFlags.flatMap((definition) =>
      definition.shortName ? [[definition.shortName, definition.longName] as const] : [],
    ),
  );
  const owner = options?.owner ?? "Command";
  const collisions: Array<{ readonly flagName: string; readonly label: string }> = [];

  for (const [optionName, definition] of Object.entries(optionDefinitions)) {
    const optionFlagName = toFlagName(optionName);

    if (reservedLongNames.has(optionFlagName)) {
      collisions.push({ flagName: optionFlagName, label: `--${optionFlagName}` });
    }

    if (definition.short) {
      const reservedLongName = reservedShortNames.get(definition.short);

      if (reservedLongName) {
        collisions.push({
          flagName: reservedLongName,
          label: `-${definition.short} / --${reservedLongName}`,
        });
      }
    }
  }

  if (collisions.length === 0) {
    return;
  }

  const uniqueCollisions = dedupeReservedOptionCollisions(collisions);
  const noun = uniqueCollisions.length === 1 ? "option" : "options";
  const verb = uniqueCollisions.length === 1 ? "is" : "are";

  throw new RemptsUsageError(
    `${owner} ${noun} ${formatReservedOptionList(uniqueCollisions.map((collision) => collision.label))} ${verb} reserved by Rempts. ` +
      reservedOptionsHint(uniqueCollisions.map((collision) => collision.flagName)),
  );
}

export const assertNoGlobalFlagCollisions = assertNoReservedOptionCollisions;

function dedupeReservedOptionCollisions(
  collisions: readonly { readonly flagName: string; readonly label: string }[],
): readonly { readonly flagName: string; readonly label: string }[] {
  const seen = new Set<string>();
  const unique: Array<{ readonly flagName: string; readonly label: string }> = [];

  for (const collision of collisions) {
    const key = `${collision.flagName}:${collision.label}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(collision);
  }

  return unique;
}

function formatReservedOptionList(labels: readonly string[]): string {
  if (labels.length <= 1) {
    return labels[0] ?? "";
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function reservedOptionsHint(flagNames: readonly string[]): string {
  const uniqueFlagNames = new Set(flagNames);
  const hints: string[] = [
    "Rempts-owned flags cannot be redefined by CLI, plugin, or command options.",
  ];

  if (uniqueFlagNames.has("apply")) {
    hints.push("Use command safety.requiresApply and ctx.safety.apply/assertApplied for --apply.");
  }

  if (uniqueFlagNames.has("help")) {
    hints.push("Help is handled by the Rempts runtime through --help.");
  }

  if (uniqueFlagNames.has("json")) {
    hints.push("JSON output is handled by the Rempts runtime through --json.");
  }

  return hints.join(" ");
}
