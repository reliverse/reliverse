import {
  isJsonObject,
  isValidJsonPointer,
  type JsonObject,
  type JsonValue,
  unescapeJsonPointerSegment,
} from "./json";

/**
 * A small, dependency-free JSONC parser and structural editor.
 *
 * It intentionally supports the JSONC surface required by DCS documents:
 * line/block comments, trailing commas, and normal JSON values. It preserves
 * the original source bytes for untouched ranges. The editor changes only the
 * AST node(s) addressed by a structured operation; it never round-trips a
 * whole document through JSON.stringify().
 */
export type DcsDocumentSyntax = "json" | "jsonc";

export interface JsoncParseError {
  readonly message: string;
  readonly offset: number;
}

interface JsoncNodeBase {
  readonly end: number;
  readonly start: number;
}

export interface JsoncScalarNode extends JsoncNodeBase {
  readonly kind: "boolean" | "null" | "number" | "string";
  readonly value: boolean | null | number | string;
}

export interface JsoncArrayNode extends JsoncNodeBase {
  readonly closeStart: number;
  readonly items: readonly JsoncNode[];
  readonly kind: "array";
  readonly openEnd: number;
}

export interface JsoncProperty {
  /** First non-trivia byte of this property (the key string). */
  readonly keyStart: number;
  readonly key: string;
  /** Trivia after the previous comma or opening brace, associated with this property. */
  readonly leadingStart: number;
  readonly value: JsoncNode;
  readonly end: number;
  readonly commaStart?: number;
}

export interface JsoncObjectNode extends JsoncNodeBase {
  readonly closeStart: number;
  readonly kind: "object";
  readonly openEnd: number;
  readonly properties: readonly JsoncProperty[];
}

export type JsoncNode = JsoncArrayNode | JsoncObjectNode | JsoncScalarNode;

export interface ParsedJsoncDocument {
  readonly root: JsoncNode;
  readonly source: string;
  readonly value: JsonValue;
}

export interface ParseJsoncResult {
  readonly error?: JsoncParseError;
  readonly ok: boolean;
  readonly parsed?: ParsedJsoncDocument;
}

export type JsoncEdit =
  | { readonly op: "delete"; readonly path: string }
  | { readonly op: "set"; readonly path: string; readonly value: JsonValue };

export interface ApplyJsoncEditsResult {
  readonly document: JsonObject;
  readonly text: string;
}

export function parseJsoncText(source: string): ParseJsoncResult {
  try {
    const parser = new JsoncParser(source);
    const parsed = parser.parse();
    return { ok: true, parsed };
  } catch (error) {
    if (error instanceof JsoncSyntaxError) {
      return {
        error: { message: error.message, offset: error.offset },
        ok: false,
      };
    }

    return {
      error: {
        message: error instanceof Error ? error.message : "Unknown JSONC parse error.",
        offset: 0,
      },
      ok: false,
    };
  }
}

/**
 * Performs property-level, lossless edits against a JSONC object document.
 * Existing values are replaced in place; new properties are inserted with the
 * surrounding object's newline, indentation, and trailing-comma convention.
 * Comments and unrelated formatting are copied byte-for-byte.
 */
export function applyJsoncEdits(
  source: string,
  edits: readonly JsoncEdit[],
): ApplyJsoncEditsResult {
  let nextText = source;

  for (const edit of edits) {
    const parsed = requireJsoncObject(nextText);
    nextText =
      edit.op === "set"
        ? setJsoncObjectPointer(nextText, parsed.root, edit.path, edit.value)
        : deleteJsoncObjectPointer(nextText, parsed.root, edit.path);
  }

  const final = requireJsoncObject(nextText);
  return Object.freeze({ document: final.value, text: nextText });
}

export function jsoncErrorMessage(error: JsoncParseError): string {
  return `${error.message} at byte ${error.offset}.`;
}

function requireJsoncObject(source: string): {
  readonly root: JsoncObjectNode;
  readonly value: JsonObject;
} {
  const result = parseJsoncText(source);
  if (!result.ok || result.parsed === undefined) {
    throw new TypeError(
      result.error === undefined
        ? "Unable to parse JSONC document."
        : jsoncErrorMessage(result.error),
    );
  }

  if (result.parsed.root.kind !== "object" || !isJsonObject(result.parsed.value)) {
    throw new TypeError("DCS JSONC document root must be an object.");
  }

  return { root: result.parsed.root, value: result.parsed.value };
}

function setJsoncObjectPointer(
  source: string,
  root: JsoncObjectNode,
  pointer: string,
  value: JsonValue,
): string {
  const segments = parseObjectPointer(pointer);
  const existing = locateProperty(root, segments);
  if (existing !== undefined) {
    return replaceRange(
      source,
      existing.property.value.start,
      existing.property.value.end,
      serializeJsoncValue(value, source, existing.property.keyStart),
    );
  }

  const insertion = locateInsertion(root, segments);
  const nested = wrapJsonObjectValue(insertion.remaining, value);
  return insertJsoncProperty(source, insertion.parent, insertion.key, nested);
}

function deleteJsoncObjectPointer(source: string, root: JsoncObjectNode, pointer: string): string {
  const segments = parseObjectPointer(pointer);
  const existing = locateProperty(root, segments);
  if (existing === undefined) {
    return source;
  }

  const property = existing.property;
  if (property.commaStart !== undefined) {
    // The next property's leading trivia stays untouched. This intentionally
    // preserves comments even when they were written after the deleted comma.
    return replaceRange(source, property.leadingStart, property.commaStart + 1, "");
  }

  // Deleting the final property leaves a legal JSONC trailing comma on the
  // preceding property when one exists. Keeping it is deliberate: it avoids
  // rewriting an otherwise untouched predecessor and preserves style.
  return replaceRange(source, property.leadingStart, property.end, "");
}

function locateProperty(
  root: JsoncObjectNode,
  segments: readonly string[],
): { readonly parent: JsoncObjectNode; readonly property: JsoncProperty } | undefined {
  let parent = root;

  for (let index = 0; index < segments.length; index += 1) {
    const key = segments[index]!;
    const property = parent.properties.find((candidate) => candidate.key === key);
    if (property === undefined) {
      return undefined;
    }

    if (index === segments.length - 1) {
      return { parent, property };
    }

    if (property.value.kind !== "object") {
      throw new TypeError(`DCS JSONC pointer crosses non-object value at ${JSON.stringify(key)}.`);
    }
    parent = property.value;
  }

  return undefined;
}

function locateInsertion(
  root: JsoncObjectNode,
  segments: readonly string[],
): {
  readonly parent: JsoncObjectNode;
  readonly key: string;
  readonly remaining: readonly string[];
} {
  let parent = root;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index]!;
    const property = parent.properties.find((candidate) => candidate.key === key);
    if (property === undefined) {
      return {
        key,
        parent,
        remaining: segments.slice(index + 1),
      };
    }

    if (property.value.kind !== "object") {
      throw new TypeError(`DCS JSONC pointer crosses non-object value at ${JSON.stringify(key)}.`);
    }
    parent = property.value;
  }

  const key = segments.at(-1);
  if (key === undefined) {
    throw new TypeError("Expected a non-root JSON Pointer.");
  }
  return { key, parent, remaining: [] };
}

function wrapJsonObjectValue(segments: readonly string[], leaf: JsonValue): JsonValue {
  let current = leaf;
  for (const segment of [...segments].reverse()) {
    current = { [segment]: current };
  }
  return current;
}

function insertJsoncProperty(
  source: string,
  object: JsoncObjectNode,
  key: string,
  value: JsonValue,
): string {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const baseIndent = lineIndent(source, object.closeStart);
  const indentUnit = inferIndentUnit(source, object, baseIndent);
  const propertyIndent = `${baseIndent}${indentUnit}`;
  const valueText = serializeJsoncValue(value, source, object.start, propertyIndent, indentUnit);
  const propertyText = `${JSON.stringify(key)}: ${valueText}`;
  const properties = object.properties;

  if (properties.length === 0) {
    const interior = source.slice(object.openEnd, object.closeStart);
    if (containsComment(interior)) {
      return insertBeforeClosingBrace(
        source,
        object,
        `${propertyText},`,
        propertyIndent,
        baseIndent,
        newline,
      );
    }

    if (!interior.includes("\n") && !interior.includes("\r")) {
      return replaceRange(source, object.openEnd, object.closeStart, ` ${propertyText} `);
    }

    return replaceRange(
      source,
      object.openEnd,
      object.closeStart,
      `${newline}${propertyIndent}${propertyText}${newline}${baseIndent}`,
    );
  }

  const last = properties.at(-1)!;
  const hadTrailingComma = last.commaStart !== undefined;
  const nextText = hadTrailingComma
    ? source
    : // Preserve inline comments after the old value by putting the delimiter at
      // the value boundary instead of rebuilding the property's trailing trivia.
      replaceRange(source, last.end, last.end, ",");
  const objectAfterDelimiter: JsoncObjectNode = hadTrailingComma
    ? object
    : {
        ...object,
        closeStart: object.closeStart + 1,
        end: object.end + 1,
        properties: Object.freeze([
          ...object.properties.slice(0, -1),
          { ...last, commaStart: last.end },
        ]),
      };

  return insertBeforeClosingBrace(
    nextText,
    objectAfterDelimiter,
    `${propertyText}${hadTrailingComma ? "," : ""}`,
    propertyIndent,
    baseIndent,
    newline,
  );
}

function insertBeforeClosingBrace(
  source: string,
  object: JsoncObjectNode,
  propertyText: string,
  propertyIndent: string,
  baseIndent: string,
  newline: string,
): string {
  const closeLineStart = lineStart(source, object.closeStart);
  const closingIndent = source.slice(closeLineStart, object.closeStart);
  const multiline =
    source.slice(object.openEnd, object.closeStart).includes("\n") ||
    source.slice(object.openEnd, object.closeStart).includes("\r");

  if (!multiline) {
    return replaceRange(source, object.closeStart, object.closeStart, ` ${propertyText}`);
  }

  if (/^[\t ]*$/.test(closingIndent)) {
    const relativeIndent = propertyIndent.startsWith(closingIndent)
      ? propertyIndent.slice(closingIndent.length)
      : propertyIndent;
    return replaceRange(
      source,
      object.closeStart,
      object.closeStart,
      `${relativeIndent}${propertyText}${newline}${closingIndent || baseIndent}`,
    );
  }

  return replaceRange(
    source,
    object.closeStart,
    object.closeStart,
    `${newline}${propertyIndent}${propertyText}${newline}${baseIndent}`,
  );
}

function serializeJsoncValue(
  value: JsonValue,
  source: string,
  anchor: number,
  forcedIndent?: string,
  forcedIndentUnit?: string,
): string {
  const baseIndent = forcedIndent ?? lineIndent(source, anchor);
  const indentUnit = forcedIndentUnit ?? inferIndentUnitFromSource(source, baseIndent);
  const serialized = JSON.stringify(value, null, indentUnit);
  if (!serialized.includes("\n")) {
    return serialized;
  }
  return serialized.replaceAll("\n", `\n${baseIndent}`);
}

function inferIndentUnit(source: string, object: JsoncObjectNode, baseIndent: string): string {
  const first = object.properties[0];
  if (first === undefined) {
    return inferIndentUnitFromSource(source, baseIndent);
  }

  const propertyIndent = lineIndent(source, first.keyStart);
  if (propertyIndent.startsWith(baseIndent) && propertyIndent.length > baseIndent.length) {
    return propertyIndent.slice(baseIndent.length);
  }
  return inferIndentUnitFromSource(source, baseIndent);
}

function inferIndentUnitFromSource(source: string, baseIndent: string): string {
  const lines = source.split(/\r?\n/u);
  const candidates = lines
    .map((line) => line.match(/^(\s+)"/u)?.[1])
    .filter((value): value is string => value !== undefined && value.length > baseIndent.length)
    .map((value) => value.slice(baseIndent.length))
    .filter((value) => value.length > 0);
  return candidates.sort((left, right) => left.length - right.length)[0] ?? "  ";
}

function lineStart(source: string, offset: number): number {
  return Math.max(source.lastIndexOf("\n", offset - 1), source.lastIndexOf("\r", offset - 1)) + 1;
}

function lineIndent(source: string, offset: number): string {
  const start = lineStart(source, offset);
  const prefix = source.slice(start, offset);
  return /^[\t ]*$/u.test(prefix) ? prefix : "";
}

function containsComment(value: string): boolean {
  return value.includes("//") || value.includes("/*");
}

function replaceRange(source: string, start: number, end: number, replacement: string): string {
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

function parseObjectPointer(pointer: string): readonly string[] {
  if (!isValidJsonPointer(pointer) || pointer === "") {
    throw new TypeError("Expected a valid non-root JSON Pointer.");
  }

  const segments = pointer.slice(1).split("/").map(unescapeJsonPointerSegment);
  if (segments.some((segment) => segment === undefined)) {
    throw new TypeError("Expected a valid JSON Pointer.");
  }
  return segments as string[];
}

class JsoncSyntaxError extends Error {
  public constructor(
    message: string,
    public readonly offset: number,
  ) {
    super(message);
    this.name = "JsoncSyntaxError";
  }
}

class JsoncParser {
  private index = 0;

  public constructor(private readonly source: string) {}

  public parse(): ParsedJsoncDocument {
    this.skipTrivia();
    const root = this.parseValue();
    this.skipTrivia();
    if (this.index !== this.source.length) {
      this.fail("Unexpected token after root value");
    }
    return { root, source: this.source, value: nodeValue(root) };
  }

  private parseValue(): JsoncNode {
    this.skipTrivia();
    const start = this.index;
    const character = this.source[this.index];

    if (character === "{") {
      return this.parseObject();
    }
    if (character === "[") {
      return this.parseArray();
    }
    if (character === '"') {
      const value = this.parseString();
      return { end: this.index, kind: "string", start, value };
    }
    if (this.source.startsWith("true", this.index)) {
      this.index += 4;
      return { end: this.index, kind: "boolean", start, value: true };
    }
    if (this.source.startsWith("false", this.index)) {
      this.index += 5;
      return { end: this.index, kind: "boolean", start, value: false };
    }
    if (this.source.startsWith("null", this.index)) {
      this.index += 4;
      return { end: this.index, kind: "null", start, value: null };
    }

    const number = this.parseNumber();
    if (number !== undefined) {
      return { end: this.index, kind: "number", start, value: number };
    }

    this.fail("Expected a JSON value");
  }

  private parseObject(): JsoncObjectNode {
    const start = this.index;
    this.index += 1;
    const openEnd = this.index;
    const properties: JsoncProperty[] = [];
    let leadingStart = this.index;
    this.skipTrivia();

    if (this.peek() === "}") {
      const closeStart = this.index;
      this.index += 1;
      return { closeStart, end: this.index, kind: "object", openEnd, properties, start };
    }

    while (true) {
      const keyStart = this.index;
      if (this.peek() !== '"') {
        this.fail("Expected an object property string key");
      }
      const key = this.parseString();
      this.skipTrivia();
      if (this.peek() !== ":") {
        this.fail("Expected ':' after object property key");
      }
      this.index += 1;
      const value = this.parseValue();
      const end = value.end;
      this.skipTrivia();

      let commaStart: number | undefined;
      if (this.peek() === ",") {
        commaStart = this.index;
        this.index += 1;
      }

      properties.push({
        ...(commaStart === undefined ? {} : { commaStart }),
        end,
        key,
        keyStart,
        leadingStart,
        value,
      });

      leadingStart = this.index;
      this.skipTrivia();
      if (this.peek() === "}") {
        const closeStart = this.index;
        this.index += 1;
        return { closeStart, end: this.index, kind: "object", openEnd, properties, start };
      }
      if (commaStart === undefined) {
        this.fail("Expected ',' or '}' after object property");
      }
    }
  }

  private parseArray(): JsoncArrayNode {
    const start = this.index;
    this.index += 1;
    const openEnd = this.index;
    const items: JsoncNode[] = [];
    this.skipTrivia();
    if (this.peek() === "]") {
      const closeStart = this.index;
      this.index += 1;
      return { closeStart, end: this.index, items, kind: "array", openEnd, start };
    }

    while (true) {
      items.push(this.parseValue());
      this.skipTrivia();
      const hasComma = this.peek() === ",";
      if (hasComma) {
        this.index += 1;
        this.skipTrivia();
      }
      if (this.peek() === "]") {
        const closeStart = this.index;
        this.index += 1;
        return { closeStart, end: this.index, items, kind: "array", openEnd, start };
      }
      if (!hasComma) {
        this.fail("Expected ',' or ']' after array item");
      }
    }
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;

    while (this.index < this.source.length) {
      const character = this.source[this.index]!;
      if (character === '"') {
        this.index += 1;
        const raw = this.source.slice(start, this.index);
        try {
          return JSON.parse(raw) as string;
        } catch {
          throw new JsoncSyntaxError("Invalid JSON string", start);
        }
      }
      if (character === "\\") {
        this.index += 2;
        continue;
      }
      if (character === "\n" || character === "\r") {
        throw new JsoncSyntaxError("Unterminated JSON string", start);
      }
      this.index += 1;
    }

    throw new JsoncSyntaxError("Unterminated JSON string", start);
  }

  private parseNumber(): number | undefined {
    const match = this.source
      .slice(this.index)
      .match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u);
    if (match === null) {
      return undefined;
    }
    const raw = match[0];
    this.index += raw.length;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      this.fail("JSON number must be finite");
    }
    return value;
  }

  private skipTrivia(): void {
    while (this.index < this.source.length) {
      const character = this.source[this.index]!;
      if (/\s/u.test(character)) {
        this.index += 1;
        continue;
      }
      if (character !== "/") {
        return;
      }

      const next = this.source[this.index + 1];
      if (next === "/") {
        this.index += 2;
        while (
          this.index < this.source.length &&
          this.source[this.index] !== "\n" &&
          this.source[this.index] !== "\r"
        ) {
          this.index += 1;
        }
        continue;
      }
      if (next === "*") {
        const close = this.source.indexOf("*/", this.index + 2);
        if (close === -1) {
          this.fail("Unterminated block comment");
        }
        this.index = close + 2;
        continue;
      }
      return;
    }
  }

  private peek(): string | undefined {
    return this.source[this.index];
  }

  private fail(message: string): never {
    throw new JsoncSyntaxError(message, this.index);
  }
}

function nodeValue(node: JsoncNode): JsonValue {
  if (node.kind === "object") {
    return Object.fromEntries(
      node.properties.map((property) => [property.key, nodeValue(property.value)]),
    );
  }
  if (node.kind === "array") {
    return node.items.map((item) => nodeValue(item));
  }
  return node.value;
}
