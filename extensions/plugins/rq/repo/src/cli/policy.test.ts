import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { inspectCliPolicy } from "./policy";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function fixture(
  packageName: string,
  includeRempts = true,
  generatedProfile = false,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "rq-cli-policy-other-repo-"));
  roots.push(root);
  const write = async (relative: string, source: string) => {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
  };
  await write(
    "package.json",
    `${JSON.stringify({ name: "@example/root", private: true, scripts: { widget: "bun apps/cli/widget/src/cli.ts" }, workspaces: ["apps/cli/*", "packages/*"] })}\n`,
  );
  await write(
    "apps/cli/widget/package.json",
    `${JSON.stringify({ name: packageName, bin: { widget: "./src/cli.ts" }, dependencies: includeRempts ? { "@reliverse/rempts": "workspace:*" } : {} })}\n`,
  );
  await write("apps/cli/widget/src/cli.ts", "#!/usr/bin/env bun\nexport {};\n");
  await write("apps/cli/widget/src/cmds/show/cmd.ts", "export default {};\n");
  if (generatedProfile) {
    await write("apps/cli/widget/src/rempts/generated-core-profile.mjs", "export {};\n");
  }
  await write(
    "packages/worker/package.json",
    `${JSON.stringify({ name: "@example/worker", bin: { worker: "./worker.ts" } })}\n`,
  );
  return root;
}

describe("repo.cli policy", () => {
  test("accepts generic apps/cli identity and only inventories non-CLI executables", async () => {
    const report = await inspectCliPolicy(await fixture("@reliverse/widget-cli"));
    expect(report.findings).toEqual([]);
    expect(report.metadata).toMatchObject({
      cliHosts: 1,
      nonCliExecutablePackages: ["packages/worker/package.json"],
    });
  });

  test("rejects an unsuffixed CLI identity and missing Rempts host dependency", async () => {
    const report = await inspectCliPolicy(await fixture("@reliverse/widget", false));
    expect(report.findings.map((finding) => finding.ruleId)).toEqual([
      "repo.cli.package-identity",
      "repo.cli.rempts-host",
    ]);
  });

  test("rejects generated declarations and both profile spellings, but not artifact glue", async () => {
    const root = await fixture("@reliverse/widget-cli");
    await mkdir(path.join(root, "apps/cli/widget/src/rempts"));
    await mkdir(path.join(root, "apps/cli/widget/dist"));
    await writeFile(
      path.join(root, "apps/cli/widget/src/rempts/generated-profile.mjs"),
      "export {};",
    );
    await writeFile(
      path.join(root, "apps/cli/widget/src/rempts/generated-core-profile.d.mts"),
      "export {};",
    );
    await writeFile(path.join(root, "apps/cli/widget/dist/generated-profile.mjs"), "export {};");
    const report = await inspectCliPolicy(root);
    expect(report.findings).toHaveLength(2);
    expect(
      report.findings.every((finding) => finding.ruleId === "repo.cli.rempts-source-native"),
    ).toBe(true);
  });

  test("rejects missing generated imports and normal validation regeneration prerequisites", async () => {
    const root = await fixture("@reliverse/widget-cli");
    const manifestPath = path.join(root, "apps/cli/widget/package.json");
    const manifest = await Bun.file(manifestPath).json();
    manifest.scripts = { pretest: "bun scripts/generate-rempts-profile.ts" };
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(
      path.join(root, "apps/cli/widget/src/cli.ts"),
      '#!/usr/bin/env bun\nimport "./rempts/generated-profile.mjs";',
    );
    const report = await inspectCliPolicy(root);
    expect(report.findings).toHaveLength(2);
    expect(
      report.findings.every((finding) => finding.ruleId === "repo.cli.rempts-source-native"),
    ).toBe(true);
  });

  test("rejects checked-in generated Rempts runtime profiles", async () => {
    const report = await inspectCliPolicy(await fixture("@reliverse/widget-cli", true, true));
    expect(report.findings.map((finding) => finding.ruleId)).toEqual([
      "repo.cli.rempts-source-native",
    ]);
  });
});
