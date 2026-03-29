import type {
  CommandOptionDefinition,
  CommandOptionsOutput,
  CommandOptionsRecord,
  NormalizedOptionIssue,
} from "./types";
import { toFlagName } from "./flag-name";
import type { StandardSchemaV1 } from "../types/standard-schema";
import { RemptsValidationError } from "../runtime/errors";

interface RuntimeStandardSchema {
  readonly "~standard": {
    readonly validate: (
      value: unknown,
      options?: StandardSchemaV1.Options | undefined,
    ) =>
      | StandardSchemaV1.Result<unknown>
      | Promise<StandardSchemaV1.Result<unknown>>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPropertyKey(value: unknown): value is PropertyKey {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "symbol"
  );
}

function isStandardSchema(value: unknown): value is RuntimeStandardSchema {
  if (!isRecord(value) || !("~standard" in value)) {
    return false;
  }

  const standard = value["~standard"];

  if (!isRecord(standard)) {
    return false;
  }

  return (
    standard.version === 1 &&
    typeof standard.vendor === "string" &&
    typeof standard.validate === "function"
  );
}

function normalizeIssuePath(path: StandardSchemaV1.Issue["path"]): readonly PropertyKey[] | undefined {
  if (!path) {
    return undefined;
  }

  const normalizedPath: PropertyKey[] = [];

  for (const segment of path) {
    if (isRecord(segment) && "key" in segment && isPropertyKey(segment.key)) {
      normalizedPath.push(segment.key);
      continue;
    }

    if (isPropertyKey(segment)) {
      normalizedPath.push(segment);
    }
  }

  return normalizedPath;
}

function runSchemaValidation(
  schema: RuntimeStandardSchema,
  value: unknown,
): ReturnType<RuntimeStandardSchema["~standard"]["validate"]> {
  return schema["~standard"].validate(value);
}

async function validateSingleOption(
  optionName: string,
  definition: CommandOptionDefinition,
  value: unknown,
): Promise<{
  readonly issues: readonly NormalizedOptionIssue[];
  readonly value: unknown;
}> {
  if (!definition.schema) {
    return {
      issues: [],
      value,
    };
  }

  const schema = definition.schema;
  const flagName = `--${toFlagName(optionName)}`;

  if (!isStandardSchema(schema)) {
    return {
      issues: [
        {
          flagName,
          message: `Option "${optionName}" uses an invalid Standard Schema adapter.`,
          optionName,
        },
      ],
      value,
    };
  }

  const result = await runSchemaValidation(schema, value);

  if (!result.issues) {
    return {
      issues: [],
      value: result.value,
    };
  }

  return {
    issues: result.issues.map((issue: StandardSchemaV1.Issue) => {
      const normalizedPath = normalizeIssuePath(issue.path);

      if (normalizedPath) {
        return {
          flagName,
          message: issue.message,
          optionName,
          path: normalizedPath,
        };
      }

      return {
        flagName,
        message: issue.message,
        optionName,
      };
    }),
    value,
  };
}

export async function validateParsedOptions<TOptions extends CommandOptionsRecord>(
  optionDefinitions: TOptions | undefined,
  rawValues: ReadonlyMap<string, unknown>,
): Promise<CommandOptionsOutput<TOptions>> {
  const normalizedValues: Record<string, unknown> = {};
  const issues: NormalizedOptionIssue[] = [];

  if (!optionDefinitions) {
    return normalizedValues as CommandOptionsOutput<TOptions>;
  }

  for (const [optionName, definition] of Object.entries(optionDefinitions)) {
    const flagName = `--${toFlagName(optionName)}`;
    const hasExplicitValue = rawValues.has(optionName);
    const rawValue = hasExplicitValue ? rawValues.get(optionName) : definition.defaultValue;

    if (rawValue === undefined) {
      if (definition.required) {
        issues.push({
          flagName,
          message: `Missing required option "${optionName}".`,
          optionName,
        });
      }

      continue;
    }

    const validation = await validateSingleOption(optionName, definition, rawValue);
    issues.push(...validation.issues);
    normalizedValues[optionName] = validation.value;
  }

  if (issues.length > 0) {
    throw new RemptsValidationError("Invalid command options.", issues);
  }

  return normalizedValues as CommandOptionsOutput<TOptions>;
}
