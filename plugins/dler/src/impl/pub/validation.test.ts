import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolvePublishableTargets } from "./validation";

describe("publish validation", () => {
  test("keeps only publishable targets and reports skipped reasons", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-validation-"));
    const okDir = join(root, "packages", "ok");
    const privateDir = join(root, "packages", "private");
    const missingDistDir = join(root, "packages", "missing-dist");
    await mkdir(join(okDir, "dist"), { recursive: true });
    await mkdir(privateDir, { recursive: true });
    await mkdir(missingDistDir, { recursive: true });

    await writeFile(
      join(okDir, "package.json"),
      JSON.stringify({ name: "ok", type: "module", publishConfig: { access: "public" } }),
      "utf8",
    );
    await writeFile(
      join(privateDir, "package.json"),
      JSON.stringify({ name: "private", private: true, type: "module", publishConfig: { access: "public" } }),
      "utf8",
    );
    await writeFile(
      join(missingDistDir, "package.json"),
      JSON.stringify({ name: "missing-dist", type: "module", publishConfig: { access: "public" } }),
      "utf8",
    );

    const result = await resolvePublishableTargets({
      publishFrom: "dist",
      targets: [
        { cwd: okDir, label: "packages/ok" },
        { cwd: privateDir, label: "packages/private" },
        { cwd: missingDistDir, label: "packages/missing-dist" },
      ],
    });

    expect(result.publishable).toEqual([
      expect.objectContaining({ label: "packages/ok", packageName: "ok" }),
    ]);
    expect(result.skipped).toEqual([
      { label: "packages/private", reason: 'package.json has "private": true (npm publish is blocked)' },
      { label: "packages/missing-dist", reason: expect.stringContaining("missing publish directory:") },
    ]);
  });
});
