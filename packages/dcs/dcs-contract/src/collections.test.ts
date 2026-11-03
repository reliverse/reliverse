import { describe, expect, test } from "bun:test";

import {
  createConfigContractBundle,
  explainConfigPath,
  parseConfigDocument,
  resolveConfigLayers,
  type DcsScope,
} from "./index";

const bundle = createConfigContractBundle({
  $dcs: {
    contractVersion: 1,
    documentVersion: 1,
    fileStem: "collections-demo",
    id: "org.reliverse.collections-demo",
    specVersion: "0.0.1",
  },
  defaults: {
    appendOnly: ["base"],
    plugins: [
      { enabled: true, id: "rse.audit", options: { retries: 1 } },
      { enabled: true, id: "rse.deploy", options: { retries: 2 } },
    ],
    tags: ["base"],
  },
  fields: {
    "/appendOnly": {
      merge: "append",
      resettable: true,
      scopes: ["user", "workspace", "local", "invocation"],
    },
    "/plugins": {
      collection: { identity: "/id" },
      merge: "keyed",
      resettable: true,
      scopes: ["user", "workspace", "local", "invocation"],
    },
    "/tags": {
      merge: "unique",
      resettable: true,
      scopes: ["user", "workspace", "local", "invocation"],
    },
  },
  schema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    properties: {
      appendOnly: { items: { type: "string" }, type: "array" },
      plugins: {
        items: {
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            id: { type: "string" },
            options: {
              additionalProperties: false,
              properties: { region: { type: "string" }, retries: { type: "number" } },
              type: "object",
            },
          },
          required: ["id", "enabled", "options"],
          type: "object",
        },
        type: "array",
      },
      tags: { items: { type: "string" }, type: "array" },
    },
    required: ["appendOnly", "plugins", "tags"],
    type: "object",
  },
});

function document(value: Record<string, unknown>, scope: DcsScope) {
  const parsed = parseConfigDocument(value as never, { bundle, scope });
  if (!parsed.ok || parsed.document === undefined) {
    throw new Error(
      parsed.diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join("\n"),
    );
  }
  return parsed.document;
}

test("collection merges append, unique and keyed values with stable identities", () => {
  const result = resolveConfigLayers({
    bundle,
    layers: [
      {
        document: document(
          {
            appendOnly: ["user"],
            plugins: [
              { enabled: false, id: "rse.deploy", options: { region: "eu" } },
              { enabled: true, id: "rse.extra", options: { retries: 5 } },
            ],
            tags: ["base", "user"],
          },
          "user",
        ),
        scope: "user",
        source: { kind: "user-document", location: "/user.json" },
      },
      {
        document: document(
          {
            $dcs: {
              collectionMoves: { "/plugins": [{ before: "rse.deploy", id: "rse.extra" }] },
              collectionRemovals: { "/plugins": ["rse.audit"] },
            },
            appendOnly: ["workspace"],
            tags: ["user", "workspace"],
          },
          "workspace",
        ),
        scope: "workspace",
        source: { kind: "workspace-document", location: "/workspace.json" },
      },
    ],
  });

  expect(result.ok).toBe(true);
  expect(result.resolved?.value).toEqual({
    appendOnly: ["base", "user", "workspace"],
    plugins: [
      { enabled: true, id: "rse.extra", options: { retries: 5 } },
      { enabled: false, id: "rse.deploy", options: { region: "eu", retries: 2 } },
    ],
    tags: ["base", "user", "workspace"],
  });
  expect(explainConfigPath(result.resolved!, "/plugins")?.effectiveSource).toEqual({
    kind: "mixed",
  });
});

test("identity directives reject arrays that have no declared stable identity", () => {
  const parsed = parseConfigDocument(
    {
      $dcs: { collectionRemovals: { "/tags": ["base"] } },
    },
    { bundle, scope: "workspace" },
  );
  expect(parsed.ok).toBe(false);
  expect(parsed.diagnostics.map((entry) => entry.code)).toContain("DCS2040");
});

test("collection directives cannot overlap a reset in the same document", () => {
  const parsed = parseConfigDocument(
    {
      $dcs: {
        collectionRemovals: { "/plugins": ["rse.audit"] },
        resets: ["/plugins"],
      },
    },
    { bundle, scope: "workspace" },
  );
  expect(parsed.ok).toBe(false);
  expect(parsed.diagnostics.map((entry) => entry.code)).toContain("DCS2042");
});

describe("schema-valued additionalProperties", () => {
  test("validates dynamic deep object keys against the additionalProperties schema", () => {
    const bundle = createConfigContractBundle({
      $dcs: {
        contractVersion: 0,
        documentVersion: 0,
        fileStem: "dynamic",
        id: "org.reliverse.dynamic",
        specVersion: "0.0.1",
      },
      defaults: { plugins: {} },
      fields: {
        "/plugins": {
          merge: "deep",
          resettable: true,
          scopes: ["workspace"],
          secret: false,
        },
      },
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
        properties: {
          plugins: {
            type: "object",
            properties: {},
            additionalProperties: {
              type: "object",
              additionalProperties: false,
              properties: {
                enabled: { type: "boolean" },
                config: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
    });
    const parsed = parseConfigDocument(
      { plugins: { "@reliverse/example": { enabled: true, config: { arbitrary: 1 } } } },
      { bundle, scope: "workspace" },
    );
    expect(parsed.ok).toBe(true);
  });
});
