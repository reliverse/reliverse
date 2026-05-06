import { describe, expect, test } from "bun:test";

import { assessDeclarDeclarationRollupStrategy } from "./rollup-strategy";
import type { DeclarEntrypoint } from "./types";

const rootEntrypoint: DeclarEntrypoint = {
  exportPath: ".",
  kind: "root",
  importPath: "./dist/index.js",
  runtimeConditions: [{ condition: "import", path: "./dist/index.js" }],
  typesConditions: [{ condition: "types", path: "./dist/index.d.ts" }],
  typesPath: "./dist/index.d.ts",
};

describe("assessDeclarDeclarationRollupStrategy", () => {
  test("keeps declarations unbundled by default", () => {
    expect(
      assessDeclarDeclarationRollupStrategy({ entrypoints: [rootEntrypoint] }),
    ).toEqual({
      recommendation: "keep-unbundled-declarations",
      risks: [],
      summary:
        "Keep per-entrypoint declarations. Bundling is optional and should stay off unless the package needs a single-file declaration surface.",
    });
  });

  test("allows the current text bundler for simple concrete declaration graphs", () => {
    expect(
      assessDeclarDeclarationRollupStrategy({
        entrypoints: [rootEntrypoint],
        preferBundledDeclarations: true,
      }),
    ).toEqual({
      recommendation: "use-current-text-bundler",
      risks: [],
      summary:
        "The current Declar text-level bundler is acceptable for this simple concrete declaration graph, with TypeScript validation after bundling.",
    });
  });

  test("recommends semantic delegation for risky package shapes", () => {
    const patternEntrypoint: DeclarEntrypoint = {
      exportPath: "./*",
      kind: "pattern",
      importPath: "./dist/*.js",
      runtimeConditions: [{ condition: "import", path: "./dist/*.js" }],
      typesConditions: [{ condition: "types", path: "./dist/*.d.ts" }],
      typesPath: "./dist/*.d.ts",
    };

    expect(
      assessDeclarDeclarationRollupStrategy({
        entrypoints: [patternEntrypoint],
        preferBundledDeclarations: true,
      }),
    ).toEqual({
      recommendation: "delegate-semantic-rollup",
      risks: ["pattern-entrypoints"],
      summary:
        "Use a proven semantic declaration rollup tool for this package shape. Declar's current bundler should remain conservative and opt-in.",
    });
  });
});
