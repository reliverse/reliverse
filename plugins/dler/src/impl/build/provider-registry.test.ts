import { describe, expect, test } from "bun:test";

import { createBuildProviderRegistry } from "./provider-registry";

describe("build provider registry", () => {
  test("exposes default provider and lookup", () => {
    const registry = createBuildProviderRegistry({
      providers: [
        {
          async buildTarget() {
            return {
              cwd: ".",
              durationMs: 1,
              exitCode: 0,
              label: "demo",
              ok: true,
              provider: "bun",
              stderr: "",
              stdout: "",
            };
          },
          id: "bun",
        },
      ],
    });

    expect(registry.defaultProvider).toBe("bun");
    expect(registry.ids).toEqual(["bun"]);
    expect(registry.get("bun")).toBeDefined();
    expect(registry.get("missing")).toBeUndefined();
  });
});
