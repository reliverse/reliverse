import type { StandardSchemaV1 } from "../types/standard-schema";

export type CommandOptionType = "boolean" | "number" | "string";
export type OptionInputSource = "default" | "env" | "flag" | "stdin";

export interface BaseOptionDefinition<
  TType extends CommandOptionType,
  TSchema extends StandardSchemaV1 | undefined = undefined,
> {
  readonly type: TType;
  readonly description?: string | undefined;
  readonly env?: string | undefined;
  readonly required?: boolean | undefined;
  readonly hint?: string | undefined;
  readonly inputSources?: ReadonlyArray<OptionInputSource> | undefined;
  readonly short?: string | undefined;
  readonly defaultValue?: PrimitiveOptionValue<TType> | undefined;
  readonly schema?: TSchema;
}

export type BooleanOptionDefinition<
  TSchema extends StandardSchemaV1 | undefined = undefined,
> = BaseOptionDefinition<"boolean", TSchema>;

export type NumberOptionDefinition<
  TSchema extends StandardSchemaV1 | undefined = undefined,
> = BaseOptionDefinition<"number", TSchema>;

export type StringOptionDefinition<
  TSchema extends StandardSchemaV1 | undefined = undefined,
> = BaseOptionDefinition<"string", TSchema>;

export type CommandOptionDefinition =
  | BooleanOptionDefinition
  | NumberOptionDefinition
  | StringOptionDefinition;

export type CommandOptionsRecord = Readonly<Record<string, CommandOptionDefinition>>;

export type PrimitiveOptionValue<TType extends CommandOptionType> =
  TType extends "boolean"
    ? boolean
    : TType extends "number"
      ? number
      : string;

export type EmptyCommandOptions = Readonly<Record<never, never>>;

type InferOptionValue<TDefinition extends CommandOptionDefinition> =
  TDefinition["schema"] extends StandardSchemaV1
    ? StandardSchemaV1.InferOutput<NonNullable<TDefinition["schema"]>>
    : PrimitiveOptionValue<TDefinition["type"]>;

type RequiredOptionKeys<TOptions extends CommandOptionsRecord> = {
  [TKey in keyof TOptions]-?: TOptions[TKey]["required"] extends true
    ? TKey
    : TOptions[TKey]["defaultValue"] extends undefined
      ? never
      : TKey;
}[keyof TOptions];

type OptionalOptionKeys<TOptions extends CommandOptionsRecord> = Exclude<
  keyof TOptions,
  RequiredOptionKeys<TOptions>
>;

export type CommandOptionsOutput<TOptions extends CommandOptionsRecord> = {
  readonly [TKey in RequiredOptionKeys<TOptions>]: InferOptionValue<TOptions[TKey]>;
} & {
  readonly [TKey in OptionalOptionKeys<TOptions>]?: InferOptionValue<TOptions[TKey]>;
};

export interface NormalizedOptionIssue {
  readonly optionName: string;
  readonly flagName: string;
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey>;
}
