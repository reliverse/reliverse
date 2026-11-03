import {
  createConfigContractBundle,
  type ConfigContractBundle,
  type DcsFieldMetadata,
  type DcsMetadata,
} from "./contract";
import type { DcsExtensionRequirement } from "./extensions";
import {
  cloneJsonValue,
  getJsonPointer,
  hasJsonPointer,
  type JsonObject,
  type JsonValue,
} from "./json";
import { schemaAtJsonPointer, type JsonSchema } from "./schema";

export const DCS_EDITOR_DESCRIPTOR_VERSION = "0.0.1" as const;

/** A renderer-safe representation of a value that may be hidden from a UI. */
export type DcsEditorStaticValue =
  | { readonly state: "absent" }
  | { readonly state: "redacted" }
  | { readonly state: "value"; readonly value: JsonValue };

/**
 * Portable, framework-neutral field descriptor. It is intentionally static:
 * document revisions, selected scope, live values, and conflicts belong to the
 * host-level editor model in @reliverse/dcs.
 */
export interface DcsEditorFieldDescriptor {
  readonly defaultValue: DcsEditorStaticValue;
  readonly metadata: DcsFieldMetadata;
  readonly path: string;
  readonly schema: JsonSchema;
}

export interface DcsEditorDescriptor {
  readonly $dcs: {
    readonly contract: DcsMetadata;
    readonly format: "dcs-editor-descriptor";
    readonly version: typeof DCS_EDITOR_DESCRIPTOR_VERSION;
  };
  readonly extensionRequirements?: readonly DcsExtensionRequirement[];
  readonly fields: readonly DcsEditorFieldDescriptor[];
}

/**
 * Builds a portable static descriptor that server-first forms, browser editors,
 * and non-TypeScript implementations can consume without importing a renderer.
 */
export function createDcsEditorDescriptor(input: ConfigContractBundle): DcsEditorDescriptor {
  const bundle = createConfigContractBundle(input);
  const fields = Object.keys(bundle.fields)
    .sort(comparePointers)
    .map((path) => fieldDescriptor(bundle, path));

  return Object.freeze({
    $dcs: Object.freeze({
      contract: Object.freeze({ ...bundle.$dcs }),
      format: "dcs-editor-descriptor" as const,
      version: DCS_EDITOR_DESCRIPTOR_VERSION,
    }),
    ...(bundle.extensionRequirements === undefined
      ? {}
      : {
          extensionRequirements: Object.freeze(
            bundle.extensionRequirements.map((entry) => Object.freeze({ ...entry })),
          ),
        }),
    fields: Object.freeze(fields),
  });
}

function fieldDescriptor(bundle: ConfigContractBundle, path: string): DcsEditorFieldDescriptor {
  const metadata = bundle.fields[path];
  const schema = schemaAtJsonPointer(bundle.schema, path);
  if (metadata === undefined || schema === undefined) {
    throw new TypeError(`DCS editor descriptor cannot resolve declared field ${path}.`);
  }

  const defaultValue =
    metadata.secret === true
      ? { state: "redacted" as const }
      : hasJsonPointer(bundle.defaults, path)
        ? { state: "value" as const, value: cloneJsonValue(getJsonPointer(bundle.defaults, path)!) }
        : { state: "absent" as const };

  return Object.freeze({
    defaultValue: Object.freeze(defaultValue),
    metadata: freezeMetadata(metadata),
    path,
    schema: cloneJsonValue(schema) as JsonObject,
  });
}

function freezeMetadata(metadata: DcsFieldMetadata): DcsFieldMetadata {
  return Object.freeze({
    ...metadata,
    ...(metadata.collection === undefined
      ? {}
      : { collection: Object.freeze({ ...metadata.collection }) }),
    ...(metadata.presentation === undefined
      ? {}
      : { presentation: Object.freeze({ ...metadata.presentation }) }),
    scopes: Object.freeze([...metadata.scopes]),
  });
}

function comparePointers(left: string, right: string): number {
  const leftDepth = left.split("/").length;
  const rightDepth = right.split("/").length;
  return leftDepth - rightDepth || left.localeCompare(right);
}
