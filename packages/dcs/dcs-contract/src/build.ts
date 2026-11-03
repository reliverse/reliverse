import {
  canonicalizeJson,
  digestCanonicalJson,
  serializeCanonicalJson,
  sha256Hex,
} from "./canonical";
import { createConfigContractBundle, type ConfigContractBundle } from "./contract";
import type { DcsExtensionRequirement } from "./extensions";
import { isJsonObject, type JsonObject, type JsonValue } from "./json";
import {
  createDcsEditorDescriptor,
  type DcsEditorDescriptor,
  type DcsEditorStaticValue,
} from "./presentation";

export type DcsPortableArtifactKind =
  | "bundle"
  | "bundle-checksum"
  | "defaults"
  | "docs-json"
  | "docs-markdown"
  | "editor-descriptor"
  | "schema";

export interface DcsGeneratedArtifact {
  readonly content: string;
  readonly filename: string;
  readonly kind: DcsPortableArtifactKind | string;
}

export interface DcsPortableArtifactBuild {
  readonly artifacts: readonly DcsGeneratedArtifact[];
  readonly bundleDigest: string;
  readonly descriptor: DcsEditorDescriptor;
}

/**
 * Deterministically projects a portable CCB into host-independent artifacts.
 * No timestamp, workspace path, generator hostname, or runtime state is ever
 * emitted, so equal bundles always produce equal bytes.
 */
export async function generateDcsPortableArtifacts(
  input: ConfigContractBundle,
): Promise<DcsPortableArtifactBuild> {
  const bundle = createConfigContractBundle(input);
  const descriptor = createDcsEditorDescriptor(bundle);
  const stem = bundle.$dcs.fileStem;
  const bundleName = `${stem}.config-contract.json`;
  const bundleContent = serializeCanonicalJson(bundle as unknown as JsonValue);
  const bundleDigest = await digestCanonicalJson(bundle as unknown as JsonValue);
  const bundleFileDigest = await sha256Hex(bundleContent);

  const artifacts: readonly DcsGeneratedArtifact[] = Object.freeze([
    artifact("bundle", bundleName, bundleContent),
    artifact(
      "bundle-checksum",
      `${stem}.config-contract.sha256`,
      `${bundleFileDigest}  ${bundleName}\n`,
    ),
    artifact("defaults", `${stem}.config.defaults.json`, serializeCanonicalJson(bundle.defaults)),
    artifact(
      "schema",
      `${stem}.config.schema.json`,
      serializeCanonicalJson(createDcsDocumentSchema(bundle)),
    ),
    artifact(
      "editor-descriptor",
      `${stem}.config.editor.json`,
      serializeCanonicalJson(descriptor as unknown as JsonValue),
    ),
    artifact(
      "docs-json",
      `${stem}.config.docs.json`,
      serializeCanonicalJson(
        createDcsDocsProjection(bundle, descriptor, bundleDigest) as unknown as JsonValue,
      ),
    ),
    artifact(
      "docs-markdown",
      `${stem}.config.docs.md`,
      createDcsDocsMarkdown(bundle, descriptor, bundleDigest),
    ),
  ]);

  return Object.freeze({ artifacts, bundleDigest, descriptor });
}

/** Editor schema for sparse authored layers, not the fully resolved runtime value. */
export function createDcsDocumentSchema(bundle: ConfigContractBundle): JsonObject {
  const sparse = (schema: JsonObject): JsonObject => {
    const { required: _, properties, ...rest } = schema;
    if (properties === null || typeof properties !== "object" || Array.isArray(properties))
      return schema;
    return {
      ...rest,
      properties: Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [
          key,
          isJsonObject(value) ? sparse(value) : value,
        ]),
      ),
    };
  };
  const schema = sparse(bundle.schema);
  return {
    ...schema,
    properties: {
      ...(schema.properties as JsonObject),
      $schema: {
        type: "string",
        description: "Local editor projection; not required for runtime resolution.",
      },
      $dcs: {
        type: "object",
        description:
          "DCS document envelope; runtime DCS validates versions, resets and collection directives.",
      },
      $extensions: { type: "object" },
    },
  };
}

export interface DcsDocsProjection {
  readonly $dcs: {
    readonly bundleDigest: string;
    readonly contract: ConfigContractBundle["$dcs"];
    readonly format: "dcs-docs";
    readonly version: "0.0.1";
  };
  readonly extensionRequirements?: readonly DcsExtensionRequirement[];
  readonly fields: readonly {
    readonly defaultValue: DcsEditorStaticValue;
    readonly deprecated?: boolean | string;
    readonly description?: string;
    readonly group?: string;
    readonly label: string;
    readonly path: string;
    readonly scopes: readonly string[];
    readonly secret: boolean;
    readonly type: string;
  }[];
}

export function createDcsDocsProjection(
  bundle: ConfigContractBundle,
  descriptor: DcsEditorDescriptor,
  bundleDigest: string,
): DcsDocsProjection {
  const fields = descriptor.fields.map((field) =>
    Object.freeze({
      defaultValue: field.defaultValue,
      ...(field.metadata.deprecated === undefined ? {} : { deprecated: field.metadata.deprecated }),
      ...(field.metadata.presentation?.description === undefined
        ? {}
        : { description: field.metadata.presentation.description }),
      ...(field.metadata.presentation?.group === undefined
        ? {}
        : { group: field.metadata.presentation.group }),
      label: field.metadata.presentation?.label ?? pointerLabel(field.path),
      path: field.path,
      scopes: Object.freeze([...field.metadata.scopes]),
      secret: field.metadata.secret === true,
      type: describeSchema(field.schema),
    }),
  );

  return Object.freeze({
    $dcs: Object.freeze({
      bundleDigest,
      contract: Object.freeze({ ...bundle.$dcs }),
      format: "dcs-docs" as const,
      version: "0.0.1" as const,
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

export function createDcsDocsMarkdown(
  bundle: ConfigContractBundle,
  descriptor: DcsEditorDescriptor,
  bundleDigest: string,
): string {
  const projection = createDcsDocsProjection(bundle, descriptor, bundleDigest);
  const lines: string[] = [
    `# ${bundle.$dcs.id} configuration`,
    "",
    "Generated by Define Config Standard. Do not edit this projection by hand.",
    "",
    `- Contract version: \`${bundle.$dcs.contractVersion}\``,
    `- Document version: \`${bundle.$dcs.documentVersion}\``,
    `- Bundle digest: \`${bundleDigest}\``,
    "",
  ];

  if (
    projection.extensionRequirements !== undefined &&
    projection.extensionRequirements.length > 0
  ) {
    lines.push("## Extension requirements", "");
    for (const requirement of projection.extensionRequirements) {
      const range = [
        requirement.minVersion === undefined ? undefined : `>=${requirement.minVersion}`,
        requirement.maxVersion === undefined ? undefined : `<=${requirement.maxVersion}`,
      ]
        .filter((entry): entry is string => entry !== undefined)
        .join(" ");
      lines.push(
        `- \`${requirement.id}\`${range.length === 0 ? "" : ` (${range})`}${requirement.required === true ? " required" : ""}`,
      );
    }
    lines.push("");
  }

  lines.push(
    "| Path | Label | Type | Default | Scopes | Description |",
    "| --- | --- | --- | --- | --- | --- |",
  );

  for (const field of projection.fields) {
    lines.push(
      [
        `\`${escapeMarkdown(field.path)}\``,
        escapeMarkdown(field.label),
        escapeMarkdown(field.type),
        escapeMarkdown(renderValue(field.defaultValue)),
        escapeMarkdown(field.scopes.join(", ")),
        escapeMarkdown(field.description ?? ""),
      ].join(" | "),
    );
  }

  return `${lines.join("\n")}\n`;
}

function artifact(
  kind: DcsPortableArtifactKind,
  filename: string,
  content: string,
): DcsGeneratedArtifact {
  return Object.freeze({ content, filename, kind });
}

function describeSchema(schema: JsonObject): string {
  if (Array.isArray(schema.enum)) {
    return "enum";
  }

  const type = schema.type;
  if (typeof type === "string") {
    return type;
  }

  if (Array.isArray(type)) {
    return type.filter((value): value is string => typeof value === "string").join(" | ");
  }

  return "unknown";
}

function pointerLabel(path: string): string {
  const segment = path.split("/").at(-1) ?? path;
  return segment
    .replaceAll("~1", "/")
    .replaceAll("~0", "~")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("-", " ")
    .replace(/^./, (value) => value.toUpperCase());
}

function renderValue(value: DcsEditorStaticValue): string {
  switch (value.state) {
    case "absent":
      return "—";
    case "redacted":
      return "[redacted]";
    case "value":
      return `\`${canonicalizeJson(value.value)}\``;
  }
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
