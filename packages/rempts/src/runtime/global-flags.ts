import type { ParsedGlobalFlags } from "./types";
import { RemptsUsageError } from "./errors";
import type { CommandOptionsRecord } from "../options/types";
import { toFlagName } from "../options/flag-name";

export type GlobalFlagKey = keyof ParsedGlobalFlags;

export interface GlobalFlagConfig {
  readonly help?: boolean | undefined;
  readonly json?: boolean | undefined;
  readonly noInput?: boolean | undefined;
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
  json: boolean;
  noInput: boolean;
}

const DEFAULT_GLOBAL_FLAGS: Readonly<Record<GlobalFlagKey, Omit<GlobalFlagDefinition, "enabled">>> = {
  help: {
    description: "Show help",
    key: "help",
    longName: "help",
    shortName: "h",
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
};

function isFlagEnabled(
  key: GlobalFlagKey,
  config: GlobalFlagConfig | undefined,
): boolean {
  const configuredValue = config?.[key];

  return configuredValue !== false;
}

export function getGlobalFlagDefinitions(
  config?: GlobalFlagConfig | undefined,
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
  config?: GlobalFlagConfig | undefined,
): ParsedGlobalFlagsResult {
  const enabledDefinitions = getGlobalFlagDefinitions(config);
  const byLongName = new Map<string, GlobalFlagDefinition>();
  const byShortName = new Map<string, GlobalFlagDefinition>();
  const remainingArgv: string[] = [];
  let consumePositionalsOnly = false;

  const flags: MutableGlobalFlags = {
    help: false,
    json: false,
    noInput: false,
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

export function assertNoGlobalFlagCollisions(
  optionDefinitions: CommandOptionsRecord | undefined,
  config?: GlobalFlagConfig | undefined,
): void {
  if (!optionDefinitions) {
    return;
  }

  const enabledDefinitions = getGlobalFlagDefinitions(config);
  const reservedLongNames = new Set(enabledDefinitions.map((definition) => definition.longName));
  const reservedShortNames = new Set(
    enabledDefinitions.flatMap((definition) =>
      definition.shortName ? [definition.shortName] : [],
    ),
  );

  for (const [optionName, definition] of Object.entries(optionDefinitions)) {
    const optionFlagName = toFlagName(optionName);

    if (reservedLongNames.has(optionFlagName)) {
      throw new RemptsUsageError(
        `Command option "--${optionFlagName}" collides with a reserved global flag.`,
      );
    }

    if (definition.short && reservedShortNames.has(definition.short)) {
      throw new RemptsUsageError(
        `Command option "-${definition.short}" collides with a reserved global flag.`,
      );
    }
  }
}
