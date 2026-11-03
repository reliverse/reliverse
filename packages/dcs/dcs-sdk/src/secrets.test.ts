import { expect, test } from "bun:test";

import {
  createDcsSecretProviderRegistry,
  createDcsSecretValue,
  dcsSecret,
  redactDcsSecretResolution,
  resolveDcsSecretReference,
  revealDcsSecretValue,
} from "./index";

test("provider registry resolves opaque values while serialization stays blocked", async () => {
  const registry = createDcsSecretProviderRegistry([
    {
      id: "memory",
      resolve(input) {
        return input.key === "demo"
          ? {
              state: "resolved" as const,
              value: createDcsSecretValue("token-value"),
            }
          : { state: "not-found" as const };
      },
    },
  ]);
  const result = await resolveDcsSecretReference({
    reference: dcsSecret("memory", "demo"),
    registry,
  });
  expect(result.state).toBe("resolved");
  if (result.state !== "resolved") {
    throw new Error("Expected a resolved secret.");
  }
  expect(revealDcsSecretValue(result.value)).toBe("token-value");
  expect(() => JSON.stringify({ value: result.value })).toThrow("cannot be serialized");
  expect(redactDcsSecretResolution(result)).toEqual({ provider: "memory", state: "resolved" });
});

test("unknown providers are reported without a provider key", async () => {
  const registry = createDcsSecretProviderRegistry([]);
  const result = await resolveDcsSecretReference({
    reference: dcsSecret("env", "PRIVATE_ENV_NAME"),
    registry,
  });
  expect(result).toEqual({ provider: "env", state: "provider-missing" });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_ENV_NAME");
});

test("provider registries reject non-canonical provider identifiers", () => {
  expect(() =>
    createDcsSecretProviderRegistry([
      {
        id: "NOT A PROVIDER",
        resolve: () => ({ state: "not-found" as const }),
      },
    ]),
  ).toThrow("lower-case data identifier");
});
