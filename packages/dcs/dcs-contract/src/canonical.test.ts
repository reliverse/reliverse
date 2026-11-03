import { expect, test } from "bun:test";

import {
  canonicalizeJson,
  digestCanonicalJson,
  generateConfigContractBundleFromIr,
  parseConfigDocument,
  resolveConfigLayers,
  validateJsonValueAgainstSchema,
  schemaAtJsonPointer,
} from "./index";
import {
  cloneJsonValue,
  getJsonPointer,
  hasJsonPointer,
  setJsonObjectPointer,
  deleteJsonObjectPointer,
  type JsonObject,
} from "./json";

test("canonicalizeJson sorts object keys recursively without changing arrays", () => {
  expect(
    canonicalizeJson({
      z: ["b", { z: true, a: null }],
      a: { y: 2, x: 1 },
    }),
  ).toBe('{"a":{"x":1,"y":2},"z":["b",{"a":null,"z":true}]}');
});

test("canonicalization and cloning preserve own prototype-named JSON properties without changing prototypes", async () => {
  const value = JSON.parse(
    '{"__proto__":{"enabled":true},"constructor":{"name":"data"},"prototype":1}',
  ) as JsonObject;
  const clone = cloneJsonValue(value);
  expect(Object.getPrototypeOf(clone)).toBe(Object.prototype);
  expect(Object.hasOwn(clone, "__proto__")).toBe(true);
  expect(canonicalizeJson(clone)).toBe(
    '{"__proto__":{"enabled":true},"constructor":{"name":"data"},"prototype":1}',
  );
  expect(await digestCanonicalJson(value)).not.toBe(
    await digestCanonicalJson({ constructor: { name: "data" }, prototype: 1 }),
  );
  expect(({} as Record<string, unknown>).enabled).toBeUndefined();
});

test("JSON pointers use only own properties and safely edit prototype-named data", () => {
  expect(getJsonPointer({}, "/constructor")).toBeUndefined();
  expect(getJsonPointer({}, "/toString")).toBeUndefined();
  expect(hasJsonPointer({}, "/__proto__")).toBe(false);
  expect(hasJsonPointer({}, "/constructor")).toBe(false);
  const value = setJsonObjectPointer({}, "/__proto__/enabled", true);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(hasJsonPointer(value, "/__proto__/enabled")).toBe(true);
  expect(getJsonPointer(value, "/__proto__/enabled")).toBe(true);
  expect(canonicalizeJson(deleteJsonObjectPointer(value, "/__proto__/enabled"))).toBe(
    '{"__proto__":{}}',
  );
  expect(canonicalizeJson(deleteJsonObjectPointer({}, "/constructor/name"))).toBe("{}");
  expect(canonicalizeJson(value)).toBe('{"__proto__":{"enabled":true}}');
  expect(({} as Record<string, unknown>).enabled).toBeUndefined();
});

test("prototype-named config fields survive IR, schema, document parsing and resolution", () => {
  const field = {
    kind: "boolean" as const,
    defaultValue: true,
    merge: "replace" as const,
    nullable: false,
    optional: false,
    resettable: true,
    scopes: ["user"] as const,
    secret: false,
  };
  const bundle = generateConfigContractBundleFromIr({
    $dcs: {
      id: "org.example.own-properties",
      fileStem: "own-properties",
      specVersion: "0.0.1",
      contractVersion: 1,
      documentVersion: 1,
    },
    root: {
      kind: "object",
      merge: "replace",
      nullable: false,
      optional: false,
      resettable: true,
      scopes: ["user"],
      secret: false,
      shape: Object.fromEntries(
        ["__proto__", "constructor", "prototype"].map((key) => [key, field]),
      ),
    },
  });
  expect(canonicalizeJson(bundle.defaults)).toBe(
    '{"__proto__":true,"constructor":true,"prototype":true}',
  );
  const source = '{"__proto__":false,"constructor":false,"prototype":false}';
  const parsed = parseConfigDocument(source, { bundle, scope: "user" });
  expect(parsed.ok).toBe(true);
  const result = resolveConfigLayers({
    bundle,
    layers: [
      {
        document: parsed.document!,
        scope: "user",
        source: { kind: "user-document", location: "fixture/config.json" },
      },
    ],
  });
  expect(result.ok).toBe(true);
  expect(canonicalizeJson(result.resolved!.value)).toBe(source);
  expect(validateJsonValueAgainstSchema({}, { type: "object", required: ["constructor"] })).toEqual(
    [{ path: "/constructor", message: "Required property is missing." }],
  );
  expect(schemaAtJsonPointer({ type: "object", properties: {} }, "/__proto__")).toBeUndefined();
  expect(
    validateJsonValueAgainstSchema(JSON.parse('{"__proto__":true}'), {
      type: "object",
      properties: {},
      additionalProperties: false,
    }),
  ).toHaveLength(1);
});

test("digestCanonicalJson is stable for semantically equal object order", async () => {
  const first = await digestCanonicalJson({ b: 2, a: 1 });
  const second = await digestCanonicalJson({ a: 1, b: 2 });

  expect(first).toBe(second);
  expect(first).toBe("43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
});
