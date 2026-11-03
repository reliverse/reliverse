import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { loadDcsExtensionRegistry } from "./extensions";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function extensionBundle(id: string, version = 1): string {
  return `${JSON.stringify(
    {
      $dcs: { format: "dcs-extension-bundle", version: "0.0.1" },
      extensions: [
        {
          $dcs: {
            compatibleDcsSpecVersions: ["0.0.1"],
            extensionVersion: version,
            format: "dcs-extension-contract",
            id,
            version: "0.0.1",
          },
          schema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            additionalProperties: false,
            properties: { enabled: { type: "boolean" } },
            type: "object",
          },
        },
      ],
    },
    null,
    2,
  )}\n`;
}

test("loads workspace and package-provided local extension bundles without network discovery", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dcs-extension-loader-"));
  temporary.push(root);
  const workspaceBundle = path.join(root, ".dcs", "extensions", "rse.dcs-extension-bundle.json");
  const packageRoot = path.join(root, "packages", "demo-extension");
  const packageBundle = path.join(packageRoot, "dcs.extensions.json");

  await mkdir(path.dirname(workspaceBundle), { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(workspaceBundle, extensionBundle("org.reliverse.rse", 2));
  await writeFile(packageBundle, extensionBundle("org.example.demo", 1));
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify(
      {
        dcs: { extensionBundles: ["./dcs.extensions.json"] },
        name: "@example/demo-extension",
      },
      null,
      2,
    ),
  );

  const result = await loadDcsExtensionRegistry({
    packageRoots: [packageRoot],
    workspaceRoot: root,
  });

  expect(result.ok).toBe(true);
  expect(Object.keys(result.registry?.contracts ?? {}).sort()).toEqual([
    "org.example.demo",
    "org.reliverse.rse",
  ]);
  expect(result.sources.map((source) => source.kind).sort()).toEqual(["package", "workspace"]);
});

test("invalid duplicate extension IDs fail instead of choosing an arbitrary source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dcs-extension-duplicate-"));
  temporary.push(root);
  const first = path.join(root, "first.dcs-extension-bundle.json");
  const second = path.join(root, "second.dcs-extension-bundle.json");
  await writeFile(first, extensionBundle("org.example.same", 1));
  await writeFile(second, extensionBundle("org.example.same", 2));

  const result = await loadDcsExtensionRegistry({ bundlePaths: [first, second] });
  expect(result.ok).toBe(false);
  expect(result.diagnostics.some((entry) => entry.code === "DCS6014")).toBe(true);
});
