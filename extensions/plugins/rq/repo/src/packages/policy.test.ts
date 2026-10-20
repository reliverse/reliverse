import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { inspectPackagePolicy } from "./policy";

const roots: string[] = [];
const rootManifest = {
  name: "@example/root",
  private: true,
  workspaces: ["packages/demo/*"],
  engines: { bun: ">=1.4.2" },
  packageManager: "bun@1.4.2",
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test("allows an explicit main family core directory to own the unsuffixed identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-package-main-core-"));
  roots.push(root);
  const familyRoot = path.join(root, "packages", "demo");
  const coreRoot = path.join(familyRoot, "demo-core");
  await mkdir(path.join(coreRoot, "src"), { recursive: true });
  await writeFile(path.join(root, "package.json"), `${JSON.stringify(rootManifest)}\n`);
  await writeFile(
    path.join(coreRoot, "package.json"),
    `${JSON.stringify({ name: "@reliverse/demo", private: false, publishConfig: { access: "public" }, exports: { ".": "./src/index.ts" } })}\n`,
  );
  await writeFile(path.join(coreRoot, "src", "index.ts"), "export {};\n");
  const report = await inspectPackagePolicy(root, { familyRoots: ["packages/demo"] });
  expect(report.findings).toEqual([]);
});

test("ignores package-family directories that contain only ignored installation residue", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-package-ignored-residue-"));
  roots.push(root);
  const familyRoot = path.join(root, "packages", "demo");
  const residueRoot = path.join(familyRoot, "retired-package", "node_modules", "dependency");
  await mkdir(residueRoot, { recursive: true });
  await writeFile(path.join(root, ".gitignore"), "node_modules/\n");
  await writeFile(path.join(root, "package.json"), `${JSON.stringify(rootManifest)}\n`);
  await writeFile(
    path.join(residueRoot, "package.json"),
    `${JSON.stringify({ name: "dependency" })}\n`,
  );

  const report = await inspectPackagePolicy(root, { familyRoots: ["packages/demo"] });
  expect(report.findings).toEqual([]);
});

test("still reports a package-family directory with visible source and no manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-package-missing-manifest-"));
  roots.push(root);
  const sourceRoot = path.join(root, "packages", "demo", "missing-manifest", "src");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(path.join(root, "package.json"), `${JSON.stringify(rootManifest)}\n`);
  await writeFile(path.join(sourceRoot, "index.ts"), "export {};\n");

  const report = await inspectPackagePolicy(root, { familyRoots: ["packages/demo"] });
  expect(report.findings.map((finding) => finding.ruleId)).toEqual([
    "repo.packages.family-manifest",
  ]);
});
