import {
  assertJsonValue,
  canonicalizeJson,
  createConfigContractBundle,
  parseConfigDocument,
  parseJsoncText,
  redactDcsSecretReferences,
  type ConfigContractBundle,
  type DcsDiagnostic,
  type JsonObject,
  type JsonValue,
  type PersistentConfigScope,
} from "@reliverse/dcs-contract";

export * from "../node";

export type DcsForeignDocumentFormat = "json" | "json5" | "jsonc" | "text" | "toml" | "yaml";
export type DcsForeignConvertTarget = "json" | "jsonc";

export interface ParseDcsBunForeignDocumentOptions {
  readonly format?: DcsForeignDocumentFormat;
  readonly location?: string;
  readonly source: string;
}

export interface ParseDcsBunForeignDocumentResult {
  readonly diagnostics: readonly DcsDiagnostic[];
  readonly format: DcsForeignDocumentFormat;
  readonly jsonCompatible: boolean;
  readonly ok: boolean;
  readonly value?: JsonValue;
}

export interface InspectDcsBunForeignDocumentOptions {
  readonly format?: DcsForeignDocumentFormat;
  readonly location: string;
}

export interface InspectDcsBunForeignDocumentResult extends ParseDcsBunForeignDocumentResult {
  readonly location: string;
  readonly valueKind?: string;
  readonly writeSupport: "none" | "safe-json" | "safe-jsonc";
}

export interface BindDcsBunForeignDocumentOptions extends InspectDcsBunForeignDocumentOptions {
  readonly bundle: ConfigContractBundle;
  readonly scope: PersistentConfigScope;
}

export interface BindDcsBunForeignDocumentResult extends InspectDcsBunForeignDocumentResult {
  readonly bindingDiagnostics: readonly DcsDiagnostic[];
  readonly bound: boolean;
  readonly contractId: string;
  readonly scope: PersistentConfigScope;
}

export interface ConvertDcsBunForeignDocumentOptions extends InspectDcsBunForeignDocumentOptions {
  readonly target: DcsForeignConvertTarget;
}

export interface ConvertDcsBunForeignDocumentResult extends InspectDcsBunForeignDocumentResult {
  readonly text?: string;
  readonly target: DcsForeignConvertTarget;
}

export function detectDcsForeignDocumentFormat(
  location: string,
): DcsForeignDocumentFormat | undefined {
  const normalized = location.toLowerCase();
  if (normalized.endsWith(".json")) return "json";
  if (normalized.endsWith(".jsonc")) return "jsonc";
  if (normalized.endsWith(".json5")) return "json5";
  if (normalized.endsWith(".yaml") || normalized.endsWith(".yml")) return "yaml";
  if (normalized.endsWith(".toml")) return "toml";
  if (normalized.endsWith(".txt") || normalized.endsWith(".text")) return "text";
  return undefined;
}

export function parseDcsBunForeignDocument(
  options: ParseDcsBunForeignDocumentOptions,
): ParseDcsBunForeignDocumentResult {
  const format = options.format ?? detectDcsForeignDocumentFormat(options.location ?? "") ?? "text";
  const diagnostics: DcsDiagnostic[] = [];

  try {
    const value = parseByBunNativeFormat(options.source, format);
    try {
      assertJsonValue(value);
      return {
        diagnostics,
        format,
        jsonCompatible: true,
        ok: true,
        value,
      };
    } catch (error) {
      diagnostics.push(
        diag(
          "DCS8002",
          `Imported ${format.toUpperCase()} value is not JSON-compatible: ${errorMessage(error)}`,
          options.location,
          "",
        ),
      );
      return { diagnostics, format, jsonCompatible: false, ok: false };
    }
  } catch (error) {
    diagnostics.push(
      diag(
        "DCS8001",
        `Unable to parse ${format.toUpperCase()} document: ${errorMessage(error)}`,
        options.location,
        "",
      ),
    );
    return { diagnostics, format, jsonCompatible: false, ok: false };
  }
}

export async function inspectDcsBunForeignDocument(
  options: InspectDcsBunForeignDocumentOptions,
): Promise<InspectDcsBunForeignDocumentResult> {
  const source = await Bun.file(options.location).text();
  const parsed = parseDcsBunForeignDocument({
    ...(options.format === undefined ? {} : { format: options.format }),
    location: options.location,
    source,
  });
  return {
    ...parsed,
    location: options.location,
    ...(parsed.value === undefined ? {} : { valueKind: valueKind(parsed.value) }),
    writeSupport: writeSupport(parsed.format),
  };
}

export async function bindDcsBunForeignDocument(
  options: BindDcsBunForeignDocumentOptions,
): Promise<BindDcsBunForeignDocumentResult> {
  const inspected = await inspectDcsBunForeignDocument(options);
  const bundle = createConfigContractBundle(options.bundle);
  if (!inspected.ok || inspected.value === undefined || !isJsonObjectLike(inspected.value)) {
    return {
      ...inspected,
      bindingDiagnostics: [
        ...inspected.diagnostics,
        ...(inspected.ok
          ? [
              diag(
                "DCS8003",
                "Only JSON-compatible object documents can be bound to a DCS contract.",
                options.location,
                "",
              ),
            ]
          : []),
      ],
      bound: false,
      contractId: bundle.$dcs.id,
      scope: options.scope,
    };
  }

  const syntax = inspected.format === "jsonc" ? "jsonc" : "json";
  const result = parseConfigDocument(inspected.value as JsonObject, {
    bundle,
    scope: options.scope,
    syntax,
  });
  return {
    ...inspected,
    bindingDiagnostics: result.diagnostics,
    bound: result.ok,
    contractId: bundle.$dcs.id,
    scope: options.scope,
  };
}

export async function convertDcsBunForeignDocument(
  options: ConvertDcsBunForeignDocumentOptions,
): Promise<ConvertDcsBunForeignDocumentResult> {
  const inspected = await inspectDcsBunForeignDocument(options);
  if (!inspected.ok || inspected.value === undefined) {
    return { ...inspected, target: options.target };
  }
  return {
    ...inspected,
    target: options.target,
    text: serializeDcsForeignConversion(inspected.value, options.target),
  };
}

export function serializeDcsForeignConversion(
  value: JsonValue,
  target: DcsForeignConvertTarget,
): string {
  if (target === "json") {
    return `${canonicalizeJson(value)}\n`;
  }

  // JSONC conversion is intentionally comment-free. Lossless JSONC edits are
  // reserved for existing DCS JSONC documents where the source AST exists.
  return `${JSON.stringify(redactDcsSecretReferences(value), null, 2)}\n`;
}

function parseByBunNativeFormat(source: string, format: DcsForeignDocumentFormat): unknown {
  switch (format) {
    case "json":
      return JSON.parse(source) as unknown;
    case "jsonc": {
      // Prefer Bun's native semantic parser when available. It strips comments
      // and trailing commas, so DCS still keeps its own JSONC AST writer for
      // lossless safe edits.
      const parser = getBunParser("JSONC");
      if (parser !== undefined) return parser.parse(source) as unknown;
      const result = parseJsoncText(source);
      if (!result.ok || result.parsed === undefined) {
        throw new Error(result.error?.message ?? "Unknown JSONC parse error.");
      }
      return result.parsed.value;
    }
    case "json5":
      return requireBunParser("JSON5").parse(source) as unknown;
    case "yaml":
      return requireBunParser("YAML").parse(source) as unknown;
    case "toml":
      return requireBunParser("TOML").parse(source) as unknown;
    case "text":
      return source;
  }
}

function requireBunParser(name: "JSON5" | "JSONC" | "TOML" | "YAML"): {
  readonly parse: (source: string) => unknown;
} {
  const parser = getBunParser(name);
  if (parser === undefined) {
    throw new Error(`Bun.${name}.parse is not available in this runtime.`);
  }
  return parser;
}

function getBunParser(
  name: "JSON5" | "JSONC" | "TOML" | "YAML",
): { readonly parse: (source: string) => unknown } | undefined {
  const bun = Bun as unknown as Partial<
    Record<typeof name, { readonly parse?: (source: string) => unknown }>
  >;
  const parser = bun[name];
  return typeof parser?.parse === "function" ? { parse: parser.parse.bind(parser) } : undefined;
}

function writeSupport(
  format: DcsForeignDocumentFormat,
): InspectDcsBunForeignDocumentResult["writeSupport"] {
  if (format === "json") return "safe-json";
  if (format === "jsonc") return "safe-jsonc";
  return "none";
}

function valueKind(value: JsonValue): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function isJsonObjectLike(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diag(
  code: string,
  message: string,
  location: string | undefined,
  path: string,
): DcsDiagnostic {
  return {
    code,
    message,
    ...(path === "" ? {} : { path }),
    severity: "error",
    ...(location === undefined ? {} : { source: { kind: "foreign-document", location } }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown parse failure.";
}
