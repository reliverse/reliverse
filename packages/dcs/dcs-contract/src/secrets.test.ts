import { expect, test } from "bun:test";

import {
  createConfigContractBundle,
  createDcsSecretReference,
  isDcsSecretReference,
  redactDcsSecretReferences,
  summarizeDcsSecretReference,
  validateDcsSecretReference,
} from "./index";

test("canonical DCS secret references are strict and never echo their key in diagnostics", () => {
  const reference = createDcsSecretReference("keychain", "rse/api-token");
  expect(isDcsSecretReference(reference)).toBe(true);
  expect(summarizeDcsSecretReference(reference)).toEqual({
    provider: "keychain",
    state: "reference",
  });
  expect(JSON.stringify(summarizeDcsSecretReference(reference))).not.toContain("api-token");

  const issues = validateDcsSecretReference({
    $secret: { key: "very-sensitive-key", provider: "NOT A PROVIDER" },
  });
  expect(issues.map((entry) => entry.code)).toContain("DCS7003");
  expect(JSON.stringify(issues)).not.toContain("very-sensitive-key");
});

test("redaction fails closed for canonical and malformed secret-shaped extension data", () => {
  const value = {
    extension: {
      malformed: { $secret: { accidental: "raw-looking-value" } },
      nested: [{ $secret: { key: "a", provider: "env" } }],
    },
  };
  expect(redactDcsSecretReferences(value)).toEqual({
    extension: {
      malformed: "<redacted>",
      nested: ["<redacted>"],
    },
  });
});

test("redaction retains prototype-named data without leaking secret references through inheritance", () => {
  const input = JSON.parse(
    '{"__proto__":{"secret":{"$secret":{"provider":"env","key":"FIXTURE_KEY"}}}}',
  );
  const result = redactDcsSecretReferences(input);
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(JSON.stringify(result)).toBe('{"__proto__":{"secret":"<redacted>"}}');
  expect((result as Record<string, unknown>).secret).toBeUndefined();
});

test("contract validation rejects a raw default at a declared secret field", () => {
  expect(() =>
    createConfigContractBundle({
      $dcs: {
        contractVersion: 1,
        documentVersion: 1,
        fileStem: "secret-demo",
        id: "org.example.secret-demo",
        specVersion: "0.0.1",
      },
      defaults: { token: "raw-secret-material" },
      fields: {
        "/token": {
          merge: "replace",
          scopes: ["user", "workspace", "local", "invocation"],
          secret: true,
        },
      },
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: false,
        properties: { token: { type: "string" } },
        required: ["token"],
        type: "object",
      },
    }),
  ).toThrow("DCS7001");
});
