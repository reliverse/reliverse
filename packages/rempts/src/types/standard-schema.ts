export interface StandardTypedV1<TInput = unknown, TOutput = TInput> {
  readonly "~standard": StandardTypedV1.Props<TInput, TOutput>;
}

export declare namespace StandardTypedV1 {
  export interface Props<TInput = unknown, TOutput = TInput> {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: Types<TInput, TOutput> | undefined;
  }

  export interface Types<TInput = unknown, TOutput = TInput> {
    readonly input: TInput;
    readonly output: TOutput;
  }

  export type InferInput<TSchema extends StandardTypedV1> = NonNullable<
    TSchema["~standard"]["types"]
  >["input"];

  export type InferOutput<TSchema extends StandardTypedV1> = NonNullable<
    TSchema["~standard"]["types"]
  >["output"];
}

export interface StandardSchemaV1<TInput = unknown, TOutput = TInput> {
  readonly "~standard": StandardSchemaV1.Props<TInput, TOutput>;
}

export declare namespace StandardSchemaV1 {
  export interface Props<TInput = unknown, TOutput = TInput>
    extends StandardTypedV1.Props<TInput, TOutput> {
    readonly validate: (
      value: unknown,
      options?: StandardSchemaV1.Options | undefined,
    ) => Result<TOutput> | Promise<Result<TOutput>>;
  }

  export type Result<TOutput> = SuccessResult<TOutput> | FailureResult;

  export interface SuccessResult<TOutput> {
    readonly value: TOutput;
    readonly issues?: undefined;
  }

  export interface Options {
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  export interface PathSegment {
    readonly key: PropertyKey;
  }

  export interface Types<TInput = unknown, TOutput = TInput>
    extends StandardTypedV1.Types<TInput, TOutput> {}

  export type InferInput<TSchema extends StandardTypedV1> =
    StandardTypedV1.InferInput<TSchema>;

  export type InferOutput<TSchema extends StandardTypedV1> =
    StandardTypedV1.InferOutput<TSchema>;
}

export interface StandardJSONSchemaV1<TInput = unknown, TOutput = TInput> {
  readonly "~standard": StandardJSONSchemaV1.Props<TInput, TOutput>;
}

export declare namespace StandardJSONSchemaV1 {
  export interface Props<TInput = unknown, TOutput = TInput>
    extends StandardTypedV1.Props<TInput, TOutput> {
    readonly jsonSchema: StandardJSONSchemaV1.Converter;
  }

  export interface Converter {
    readonly input: (
      options: StandardJSONSchemaV1.Options,
    ) => Record<string, unknown>;
    readonly output: (
      options: StandardJSONSchemaV1.Options,
    ) => Record<string, unknown>;
  }

  export type Target =
    | "draft-2020-12"
    | "draft-07"
    | "openapi-3.0"
    | ({} & string);

  export interface Options {
    readonly target: Target;
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }

  export interface Types<TInput = unknown, TOutput = TInput>
    extends StandardTypedV1.Types<TInput, TOutput> {}

  export type InferInput<TSchema extends StandardTypedV1> =
    StandardTypedV1.InferInput<TSchema>;

  export type InferOutput<TSchema extends StandardTypedV1> =
    StandardTypedV1.InferOutput<TSchema>;
}
