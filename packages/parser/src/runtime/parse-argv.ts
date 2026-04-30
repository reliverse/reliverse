import { toFlagName } from "../options/flag-name";
import type {
  CommandOptionDefinition,
  CommandOptionsOutput,
  CommandOptionsRecord,
  OptionInputSource,
} from "../options/types";
import { validateParsedOptions } from "../options/validate";
import { ParserUsageError } from "./errors";

export interface ParseArgvResult<TOptions extends CommandOptionsRecord> {
  readonly args: readonly string[];
  readonly options: CommandOptionsOutput<TOptions>;
}

function isInputSourceEnabled(
  definition: CommandOptionDefinition,
  source: OptionInputSource,
): boolean {
  return !definition.inputSources || definition.inputSources.includes(source);
}

function assertInputSourceEnabled(
  definition: CommandOptionDefinition,
  source: OptionInputSource,
  label: string,
): void {
  if (isInputSourceEnabled(definition, source)) {
    return;
  }

  throw new ParserUsageError(`Option "${label}" does not accept ${source} input.`);
}

function isBooleanString(value: string): boolean {
  const normalized = value.toLowerCase();
  return ["true", "false", "1", "0", "yes", "no", "on", "off"].includes(normalized);
}

function toBoolean(value: string, label: string): boolean {
  const normalized = value.toLowerCase();

  if (!isBooleanString(normalized)) {
    throw new ParserUsageError(`Expected a boolean value for "${label}", received "${value}".`);
  }

  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function toNumber(value: string, label: string): number {
  if (value.trim().length === 0) {
    throw new ParserUsageError(`Expected a number value for "${label}", received an empty value.`);
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new ParserUsageError(
      `Expected a finite number value for "${label}", received "${value}".`,
    );
  }

  return parsed;
}

function coerceOptionValue(
  label: string,
  definition: CommandOptionDefinition,
  rawValue: string,
): unknown {
  if (definition.type === "boolean") {
    return toBoolean(rawValue, label);
  }

  if (definition.type === "number") {
    return toNumber(rawValue, label);
  }

  return rawValue;
}

function looksLikeOptionToken(value: string): boolean {
  return value.startsWith("-") && value !== "-";
}

function setRawOptionValue(
  rawOptionValues: Map<string, unknown>,
  optionName: string,
  value: unknown,
  label: string,
): void {
  if (rawOptionValues.has(optionName)) {
    throw new ParserUsageError(`Option "${label}" was provided more than once.`);
  }

  rawOptionValues.set(optionName, value);
}

function setLongOption(
  longOptions: Map<string, readonly [string, CommandOptionDefinition]>,
  flagName: string,
  optionName: string,
  definition: CommandOptionDefinition,
): void {
  const existing = longOptions.get(flagName);

  if (existing && existing[0] !== optionName) {
    throw new ParserUsageError(
      `Option flag "--${flagName}" is ambiguous between "${existing[0]}" and "${optionName}".`,
    );
  }

  longOptions.set(flagName, [optionName, definition]);
}

function setShortOption(
  shortOptions: Map<string, readonly [string, CommandOptionDefinition]>,
  shortName: string,
  optionName: string,
  definition: CommandOptionDefinition,
): void {
  if (shortName.length !== 1 || shortName === "-") {
    throw new ParserUsageError(
      `Option "${optionName}" has invalid short flag "${shortName}". Short flags must be one character.`,
    );
  }

  const existing = shortOptions.get(shortName);

  if (existing && existing[0] !== optionName) {
    throw new ParserUsageError(
      `Option short flag "-${shortName}" is ambiguous between "${existing[0]}" and "${optionName}".`,
    );
  }

  shortOptions.set(shortName, [optionName, definition]);
}

function addEnvOptionValues(
  rawOptionValues: Map<string, unknown>,
  optionDefinitions: CommandOptionsRecord | undefined,
  env: NodeJS.ProcessEnv | undefined,
): void {
  if (!optionDefinitions || !env) {
    return;
  }

  for (const [optionName, definition] of Object.entries(optionDefinitions)) {
    if (rawOptionValues.has(optionName) || !definition.env) {
      continue;
    }

    if (!isInputSourceEnabled(definition, "env")) {
      continue;
    }

    const envValue = env[definition.env];

    if (envValue === undefined) {
      continue;
    }

    rawOptionValues.set(optionName, coerceOptionValue(`$${definition.env}`, definition, envValue));
  }
}

export async function parseArgvTail<TOptions extends CommandOptionsRecord>(
  argv: readonly string[],
  optionDefinitions: TOptions | undefined,
  env?: NodeJS.ProcessEnv,
): Promise<ParseArgvResult<TOptions>> {
  const args: string[] = [];
  const rawOptionValues = new Map<string, unknown>();
  const longOptions = new Map<string, readonly [string, CommandOptionDefinition]>();
  const shortOptions = new Map<string, readonly [string, CommandOptionDefinition]>();
  let cursor = 0;
  let consumePositionalsOnly = false;

  if (optionDefinitions) {
    for (const [optionName, definition] of Object.entries(optionDefinitions)) {
      const flagName = toFlagName(optionName);
      setLongOption(longOptions, optionName, optionName, definition);
      setLongOption(longOptions, flagName, optionName, definition);

      if (definition.short) {
        setShortOption(shortOptions, definition.short, optionName, definition);
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
        throw new ParserUsageError(`Unknown option "--${key}".`);
      }

      const [optionName, definition] = optionEntry;
      const flagLabel = `--${key}`;
      assertInputSourceEnabled(definition, "flag", flagLabel);

      if (definition.type === "boolean") {
        if (negated) {
          if (explicitValue !== undefined) {
            throw new ParserUsageError(`Option "${flagLabel}" does not accept a value.`);
          }

          setRawOptionValue(rawOptionValues, optionName, false, flagLabel);
          cursor += 1;
          continue;
        }

        if (explicitValue !== undefined) {
          setRawOptionValue(
            rawOptionValues,
            optionName,
            toBoolean(explicitValue, flagLabel),
            flagLabel,
          );
          cursor += 1;
          continue;
        }

        setRawOptionValue(rawOptionValues, optionName, true, flagLabel);
        cursor += 1;
        continue;
      }

      if (negated) {
        throw new ParserUsageError(`Option "--${normalizedKey}" does not support "--no-" form.`);
      }

      const nextToken = argv[cursor + 1];
      const rawValue = explicitValue ?? nextToken;

      if (
        rawValue === undefined ||
        (explicitValue === undefined && looksLikeOptionToken(rawValue))
      ) {
        throw new ParserUsageError(`Option "${flagLabel}" expects a value.`);
      }

      setRawOptionValue(
        rawOptionValues,
        optionName,
        coerceOptionValue(flagLabel, definition, rawValue),
        flagLabel,
      );
      cursor += explicitValue === undefined ? 2 : 1;
      continue;
    }

    const shortKey = token.slice(1);
    const optionEntry = shortOptions.get(shortKey);

    if (!optionEntry) {
      throw new ParserUsageError(`Unknown option "-${shortKey}".`);
    }

    const [optionName, definition] = optionEntry;
    const flagLabel = `-${shortKey}`;
    assertInputSourceEnabled(definition, "flag", flagLabel);

    if (definition.type === "boolean") {
      setRawOptionValue(rawOptionValues, optionName, true, flagLabel);
      cursor += 1;
      continue;
    }

    const nextToken = argv[cursor + 1];

    if (nextToken === undefined || looksLikeOptionToken(nextToken)) {
      throw new ParserUsageError(`Option "${flagLabel}" expects a value.`);
    }

    setRawOptionValue(
      rawOptionValues,
      optionName,
      coerceOptionValue(flagLabel, definition, nextToken),
      flagLabel,
    );
    cursor += 2;
  }

  addEnvOptionValues(rawOptionValues, optionDefinitions, env);

  return {
    args,
    options: await validateParsedOptions(optionDefinitions, rawOptionValues),
  };
}
