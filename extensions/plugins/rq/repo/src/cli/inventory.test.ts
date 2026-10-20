import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { inspectCliHostInventory } from "./inventory";

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

test("inventories canonical CLI package identity and Rempts hosting independently", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-cli-inventory-"));
  await writeJson(path.join(root, "package.json"), {
    name: "@fixture/root",
    private: true,
    workspaces: ["apps/cli/*"],
  });
  await writeJson(path.join(root, "apps/cli/rvs/package.json"), {
    name: "@reliverse/rvs-cli",
    version: "0.1.0",
    bin: { rvs: "./src/cli.ts" },
    dependencies: { "@reliverse/rempts": "workspace:*" },
  });
  await writeJson(path.join(root, "apps/cli/rev/package.json"), {
    name: "@reliverse/rev-cli",
    version: "0.1.0",
    bin: { rev: "./src/cli.ts" },
  });

  const inventory = await inspectCliHostInventory(root);
  expect(inventory.summary).toEqual({
    total: 2,
    canonicalPackageNames: 2,
    legacyUnsuffixedPackageNames: 0,
    unexpectedPackageNames: 0,
    remptsHosts: 1,
    nonRemptsHosts: 1,
  });
  expect(inventory.entries.find((entry) => entry.directory === "rvs")).toMatchObject({
    packageIdentityState: "canonical",
    remptsHostState: "present",
  });
  expect(inventory.entries.find((entry) => entry.directory === "rev")).toMatchObject({
    packageIdentityState: "canonical",
    remptsHostState: "missing",
  });
});
