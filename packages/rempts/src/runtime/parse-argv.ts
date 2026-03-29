import type {
  CommandOptionDefinition,
  CommandOptionsOutput,
  CommandOptionsRecord,
} from "../options/types";
import { toFlagName } from "../options/flag-name";
import { validateParsedOptions } from "../options/validate";
import { RemptsUsageError } from "./errors";

export interface ParseArgvResult<TOptions extends CommandOptionsRecord> {
  readonly args: readonly string[];
  readonly options: CommandOptionsOutput<TOptions>;
}

function isBooleanString(value: string): boolean {
  return value === "true" || value === "false";
}

function toBoolean(value: string): boolean {
  if (!isBooleanString(value)) {
    throw new RemptsUsageError(`Expected a boolean value, received "${value}".`);
  }

  return value === "true";
}

function toNumber(value: string): number {
  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    throw new RemptsUsageError(`Expected a number value, received "${value}".`);
  }

  return parsed;
}

export async function parseArgvTail<TOptions extends CommandOptionsRecord>(
  argv: readonly string[],
  optionDefinitions: TOptions | undefined,
): Promise<ParseArgvResult<TOptions>> {
  const args: string[] = [];
  const rawOptionValues = new Map<string, unknown>();
  const longOptions = new Map<string, readonly [string, CommandOptionDefinition]>();
  const shortOptions = new Map<string, readonly [string, CommandOptionDefinition]>();
  let cursor = 0;
  let consumePositionalsOnly = false;

  if (optionDefinitions) {
    for (const [optionName, definition] of Object.entries(optionDefinitions)) {
      longOptions.set(optionName, [optionName, definition]);
      const flagName = toFlagName(optionName);

      if (!longOptions.has(flagName)) {
        longOptions.set(flagName, [optionName, definition]);
      }

      if (definition.short) {
        shortOptions.set(definition.short, [optionName, definition]);
      }
    }
  }

  while (cursor < argv.length) {
    const token = argv[cursor];

    if (token === undefined) {
      break;
    }

    if (consumePositionalsOnly) {
      args.push(token);
      cursor += 1;
      continue;
    }

    if (token === "--") {
      consumePositionalsOnly = true;
      cursor += 1;
      continue;
    }

    if (!token.startsWith("-") || token === "-") {
      args.push(token);
      cursor += 1;
      continue;
    }

    if (token.startsWith("--")) {
      const withoutPrefix = token.slice(2);
      const separatorIndex = withoutPrefix.indexOf("=");
      const key = separatorIndex >= 0 ? withoutPrefix.slice(0, separatorIndex) : withoutPrefix;
      const explicitValue =
        separatorIndex >= 0 ? withoutPrefix.slice(separatorIndex + 1) : undefined;
      const negated = key.startsWith("no-");
      const normalizedKey = negated ? key.slice(3) : key;
      const optionEntry = longOptions.get(normalizedKey);

      if (!optionEntry) {
        throw new RemptsUsageError(`Unknown option "--${normalizedKey}".`);
      }

      const [optionName, definition] = optionEntry;

      if (definition.type === "boolean") {
        if (negated) {
          rawOptionValues.set(optionName, false);
          cursor += 1;
          continue;
        }

        if (explicitValue !== undefined) {
          rawOptionValues.set(optionName, toBoolean(explicitValue));
          cursor += 1;
          continue;
        }

        rawOptionValues.set(optionName, true);
        cursor += 1;
        continue;
      }

      if (negated) {
        throw new RemptsUsageError(`Option "--${normalizedKey}" does not support "--no-" form.`);
      }

      const nextToken = argv[cursor + 1];
      const rawValue = explicitValue ?? nextToken;

      if (rawValue === undefined) {
        throw new RemptsUsageError(`Option "--${normalizedKey}" expects a value.`);
      }

      rawOptionValues.set(
        optionName,
        definition.type === "number" ? toNumber(rawValue) : rawValue,
      );
      cursor += explicitValue === undefined ? 2 : 1;
      continue;
    }

    const shortKey = token.slice(1);
    const optionEntry = shortOptions.get(shortKey);

    if (!optionEntry) {
      throw new RemptsUsageError(`Unknown option "-${shortKey}".`);
    }

    const [optionName, definition] = optionEntry;

    if (definition.type === "boolean") {
      rawOptionValues.set(optionName, true);
      cursor += 1;
      continue;
    }

    const nextToken = argv[cursor + 1];

    if (nextToken === undefined) {
      throw new RemptsUsageError(`Option "-${shortKey}" expects a value.`);
    }

    rawOptionValues.set(optionName, definition.type === "number" ? toNumber(nextToken) : nextToken);
    cursor += 2;
  }

  return {
    args,
    options: await validateParsedOptions(optionDefinitions, rawOptionValues),
  };
}
