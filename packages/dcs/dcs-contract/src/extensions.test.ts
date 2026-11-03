import { expect, test } from "bun:test";

import {
  JSON_SCHEMA_2020_12_DIALECT,
  createConfigContractBundle,
  createDcsExtensionBundle,
  createDcsExtensionContract,
  createDcsExtensionRegistry,
  generateDcsPortableArtifacts,
  parseConfigDocument,
  validateDcsExtensionDocument,
} from "./index";

const extension = createDcsExtensionContract({
  $dcs: {
    compatibleDcsSpecVersions: ["0.0.1"],
    extensionVersion: 2,
    format: "dcs-extension-contract",
    id: "org.reliverse.rse",
    version: "0.0.1",
  },
  presentation: {
    description: "Rse editor settings.",
    group: "Agents",
    label: "Rse",
    order: 10,
  },
  schema: {
    $schema: JSON_SCHEMA_2020_12_DIALECT,
    additionalProperties: false,
    properties: {
      mode: { enum: ["assist", "review"] },
    },
    required: ["mode"],
    type: "object",
  },
});

const bundle = createConfigContractBundle({
  $dcs: {
    contractVersion: 1,
    documentVersion: 1,
    fileStem: "demo-tool",
    id: "org.example.demo-tool",
    specVersion: "0.0.1",
  },
  defaults: { telemetry: false },
  extensionRequirements: [{ id: "org.reliverse.rse", minVersion: 2, required: true }],
  fields: {
    "/telemetry": { merge: "replace", scopes: ["user", "workspace", "local", "invocation"] },
  },
  schema: {
    $schema: JSON_SCHEMA_2020_12_DIALECT,
    additionalProperties: false,
    properties: { telemetry: { type: "boolean" } },
    required: ["telemetry"],
    type: "object",
  },
});

test("known extension values validate against a local extension contract", () => {
  const registry = createDcsExtensionRegistry([extension]);
  const result = parseConfigDocument(
    {
      $extensions: {
        "org.reliverse.rse": { mode: "assist" },
      },
    },
    {
      bundle,
      extensionRegistry: registry,
      scope: "workspace",
    },
  );

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("invalid known extension values fail validation while unknown namespaces remain opaque", () => {
  const registry = createDcsExtensionRegistry([extension]);
  const result = parseConfigDocument(
    {
      $extensions: {
        "org.example.future": { enabled: true },
        "org.reliverse.rse": { mode: "dangerous" },
      },
    },
    {
      bundle,
      extensionRegistry: registry,
      scope: "workspace",
    },
  );

  expect(result.ok).toBe(false);
  expect(result.diagnostics.some((entry) => entry.code === "DCS6030")).toBe(true);
  expect(
    result.diagnostics.some((entry) => entry.code === "DCS6027" && entry.severity === "warning"),
  ).toBe(true);
});

test("required extension absence is rejected even before a registry is supplied", () => {
  const diagnostics = validateDcsExtensionDocument({
    bundle,
    extensions: {},
  });
  expect(diagnostics).toContainEqual(
    expect.objectContaining({ code: "DCS6024", severity: "error" }),
  );
});

test("extension bundle is a portable data artifact", () => {
  const extensionBundle = createDcsExtensionBundle({
    $dcs: { format: "dcs-extension-bundle", version: "0.0.1" },
    extensions: [extension],
  });
  expect(extensionBundle.extensions[0]?.$dcs.id).toBe("org.reliverse.rse");
});

test("extension requirements project into portable editor and docs artifacts", async () => {
  const artifacts = await generateDcsPortableArtifacts(bundle);
  const descriptor = JSON.parse(
    artifacts.artifacts.find((artifact) => artifact.kind === "editor-descriptor")!.content,
  ) as {
    readonly extensionRequirements?: unknown;
  };
  const docs = artifacts.artifacts.find((artifact) => artifact.kind === "docs-markdown")!.content;

  expect(descriptor.extensionRequirements).toEqual([
    { id: "org.reliverse.rse", minVersion: 2, required: true },
  ]);
  expect(docs).toContain("## Extension requirements");
  expect(docs).toContain("`org.reliverse.rse` (>=2) required");
});
