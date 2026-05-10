import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPublishStaging } from "./staging";

describe("publish staging", () => {
  test("uses prepared publish metadata when provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-staging-"));
    const pkgDir = join(root, "packages", "demo");
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "demo",
        type: "module",
        devDependencies: { typescript: "catalog:" },
        exports: { ".": { types: "./src/index.ts", import: "./src/index.ts" } },
      }),
      "utf8",
    );
    await writeFile(join(pkgDir, "dist", "index.js"), "export {};\n", "utf8");

    const staging = await createPublishStaging(pkgDir, "dist", {
      name: "demo",
      type: "module",
      types: "./dist/index.d.ts",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    });

    try {
      await expect(readFile(join(staging.stagingDir, "package.json"), "utf8")).resolves.toBe(
        `${JSON.stringify(
          {
            name: "demo",
            type: "module",
            types: "./dist/index.d.ts",
            exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
            files: ["package.json", "dist"],
          },
          null,
          2,
        )}\n`,
      );
    } finally {
      await staging.cleanup();
    }
  });

  test("prunes ignored declaration artifacts from staging", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-staging-"));
    const pkgDir = join(root, "packages", "demo");
    await mkdir(join(pkgDir, "dist", "nested"), { recursive: true });
    await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    await writeFile(join(pkgDir, "dist", "index.d.ts"), "export {};\n", "utf8");
    await writeFile(join(pkgDir, "dist", "index.test.d.ts"), "export {};\n", "utf8");
    await writeFile(join(pkgDir, "dist", "nested", "cli.spec.d.mts"), "export {};\n", "utf8");
    await writeFile(join(pkgDir, "dist", "index.test.js"), "export {};\n", "utf8");

    const staging = await createPublishStaging(pkgDir, "dist");

    try {
      await expect(readFile(join(staging.stagingDir, "dist", "index.d.ts"), "utf8")).resolves.toBe(
        "export {};\n",
      );
      await expect(
        readFile(join(staging.stagingDir, "dist", "index.test.js"), "utf8"),
      ).resolves.toBe("export {};\n");
      await expect(
        readFile(join(staging.stagingDir, "dist", "index.test.d.ts"), "utf8"),
      ).rejects.toThrow();
      await expect(
        readFile(join(staging.stagingDir, "dist", "nested", "cli.spec.d.mts"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await staging.cleanup();
    }
  });
});
