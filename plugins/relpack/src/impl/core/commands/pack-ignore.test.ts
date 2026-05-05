import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildIgnoredNames } from "../ignore";
import { listArchive } from "./list";
import { packArchive } from "./pack";

describe("pack ignore policy", () => {
  test("default ignored names are not included in tar archives", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "relpack-ignore-"));
    await writeFile(path.join(cwd, "package.json"), "{}\n");
    await mkdir(path.join(cwd, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(cwd, "node_modules", "pkg", "index.js"), "export {};\n");
    await mkdir(path.join(cwd, "dist"), { recursive: true });
    await writeFile(path.join(cwd, "dist", "bundle.js"), "console.log('nope');\n");

    const ignoredNames = buildIgnoredNames({ includeDefaultIgnores: true });
    const output = "archive.tar";
    const ctx = { cwd, env: process.env };

    await packArchive(
      {
        cwd,
        inputs: ["."],
        output,
        format: "tar",
        overwrite: "never",
        dryRun: false,
        ignoredNames,
      },
      ctx,
    );

    const entries = await listArchive({ cwd, archive: output, format: "tar" }, ctx);
    const paths = entries.map((entry) => entry.path);

    expect(paths.some((entryPath) => entryPath.includes("package.json"))).toBe(true);
    expect(paths.some((entryPath) => entryPath.includes("node_modules"))).toBe(false);
    expect(paths.some((entryPath) => entryPath.includes("dist"))).toBe(false);
  });
});
