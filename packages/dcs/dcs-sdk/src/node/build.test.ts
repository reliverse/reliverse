import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { c, defineConfig } from "../index";
import { checkDcsGeneratedArtifacts, writeDcsGeneratedArtifacts } from "./build";

const bundle = defineConfig({
  fileStem: "demo-tool",
  id: "org.example.demo-tool",
  root: c.object({
    enabled: c.boolean().default(true),
  }),
}).bundle;

test("generated artifact writer detects drift and rewrites only stale output", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dcs-build-"));
  try {
    const initial = await checkDcsGeneratedArtifacts({ bundle, outputDirectory: directory });
    expect(initial.upToDate).toBe(false);
    expect(initial.statuses.every((status) => status.state === "missing")).toBe(true);

    const written = await writeDcsGeneratedArtifacts({ bundle, outputDirectory: directory });
    expect(written.upToDate).toBe(true);
    expect(written.written).toHaveLength(9);
    expect(
      (await checkDcsGeneratedArtifacts({ bundle, outputDirectory: directory })).upToDate,
    ).toBe(true);

    const declaration = path.join(directory, "demo-tool.config.d.ts");
    await writeFile(declaration, "// stale\n", "utf8");
    const stale = await checkDcsGeneratedArtifacts({ bundle, outputDirectory: directory });
    expect(
      stale.statuses.find((status) => status.filename === "demo-tool.config.d.ts")?.state,
    ).toBe("stale");

    const repaired = await writeDcsGeneratedArtifacts({ bundle, outputDirectory: directory });
    expect(repaired.written).toEqual(["demo-tool.config.d.ts"]);
    expect(await readFile(declaration, "utf8")).toContain("DemoToolConfig");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
