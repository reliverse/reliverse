import { expect, test } from "bun:test";

import {
  createConfigContractBundle,
  generateDcsPortableArtifacts,
  type ConfigContractBundle,
} from "./index";
import { validateJsonValueAgainstSchema } from "./schema";

test("numeric schema bounds enforce inclusive/exclusive limits without coercion", () => {
  const schema = { type: "integer", minimum: 1, maximum: 18_000 };
  for (const value of [1, 18_000])
    expect(validateJsonValueAgainstSchema(value, schema)).toEqual([]);
  for (const value of [0, -1, 18_001, 1.5, "18000", Infinity, NaN])
    expect(validateJsonValueAgainstSchema(value, schema).length).toBeGreaterThan(0);
  for (const value of [1, 2])
    expect(
      validateJsonValueAgainstSchema(value, {
        type: "number",
        exclusiveMinimum: 1,
        exclusiveMaximum: 2,
      }).length,
    ).toBeGreaterThan(0);
  expect(
    validateJsonValueAgainstSchema(1.5, {
      type: "number",
      exclusiveMinimum: 1,
      exclusiveMaximum: 2,
    }),
  ).toEqual([]);
  expect(
    validateJsonValueAgainstSchema(
      { deadline: 18_001 },
      { type: "object", properties: { deadline: schema } },
    )[0]?.path,
  ).toBe("/deadline");
});

function bundle(): ConfigContractBundle {
  return createConfigContractBundle({
    $dcs: {
      contractVersion: 1,
      documentVersion: 1,
      fileStem: "demo-tool",
      id: "org.example.demo-tool",
      specVersion: "0.0.1",
    },
    defaults: { enabled: true, mode: "safe" },
    fields: {
      "/enabled": {
        merge: "replace",
        presentation: {
          control: "checkbox",
          description: "Allow the feature.",
          group: "General",
          label: "Feature enabled",
          order: 10,
        },
        resettable: true,
        scopes: ["user", "workspace"],
        secret: false,
      },
      "/mode": {
        merge: "replace",
        resettable: true,
        scopes: ["user", "workspace"],
        secret: false,
      },
      "/token": {
        merge: "replace",
        resettable: true,
        scopes: ["user"],
        secret: true,
      },
    },
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        mode: { enum: ["safe", "fast"] },
        token: {
          additionalProperties: false,
          properties: {
            $secret: {
              additionalProperties: false,
              properties: { key: { type: "string" }, provider: { type: "string" } },
              required: ["provider", "key"],
              type: "object",
            },
          },
          required: ["$secret"],
          type: "object",
        },
      },
      required: ["enabled", "mode"],
      type: "object",
    },
  });
}

test("portable build outputs are deterministic and presentation-aware", async () => {
  const first = await generateDcsPortableArtifacts(bundle());
  const second = await generateDcsPortableArtifacts(bundle());

  expect(first.bundleDigest).toBe(second.bundleDigest);
  expect(first.artifacts).toEqual(second.artifacts);
  expect(first.artifacts.map((artifact) => artifact.filename)).toEqual([
    "demo-tool.config-contract.json",
    "demo-tool.config-contract.sha256",
    "demo-tool.config.defaults.json",
    "demo-tool.config.schema.json",
    "demo-tool.config.editor.json",
    "demo-tool.config.docs.json",
    "demo-tool.config.docs.md",
  ]);

  const enabled = first.descriptor.fields.find((field) => field.path === "/enabled");
  const token = first.descriptor.fields.find((field) => field.path === "/token");
  expect(enabled?.metadata.presentation).toMatchObject({
    control: "checkbox",
    label: "Feature enabled",
  });
  expect(token?.defaultValue).toEqual({ state: "redacted" });
  expect(first.artifacts.find((artifact) => artifact.kind === "docs-markdown")?.content).toContain(
    "Feature enabled",
  );
});
