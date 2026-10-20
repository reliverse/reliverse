import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { inspectDependencyPolicy } from "./policy";
import { REPO_DEPENDENCY_RULE_IDS } from "./rules";

async function write(root: string, relative: string, content: string): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

test("unpublished development scripts need declarations without pretending to be production", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-development-script-"));
  try {
    await write(
      root,
      "package.json",
      JSON.stringify({ private: true, workspaces: ["packages/*"] }),
    );
    await write(root, "packages/tool/package.json", JSON.stringify({ name: "@fixture/tool" }));
    await write(root, "packages/tool/src/index.ts", "export const build = () => {};\n");
    const host = {
      name: "@fixture/host",
      files: ["src", "README.md"],
      exports: "./src/index.ts",
      scripts: { build: "bun scripts/build.ts" },
      devDependencies: { "@fixture/tool": "workspace:*" },
    };
    await write(root, "packages/host/package.json", JSON.stringify(host));
    await write(root, "packages/host/src/index.ts", "export const host = 1;\n");
    await write(root, "packages/host/scripts/build.ts", 'import "@fixture/tool";\n');
    expect((await inspectDependencyPolicy(root)).findings).toEqual([]);
    await write(
      root,
      "packages/host/package.json",
      JSON.stringify({ ...host, devDependencies: {} }),
    );
    const findings = (await inspectDependencyPolicy(root)).findings;
    expect(findings.map((f) => f.ruleId)).toEqual([
      REPO_DEPENDENCY_RULE_IDS.developmentDeclaration,
    ]);
    expect(findings[0]?.message).toContain("scripts/build.ts");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production and type reachability, published scripts and ambiguous files still require runtime dependencies", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-script-runtime-boundary-"));
  try {
    await write(
      root,
      "package.json",
      JSON.stringify({ private: true, workspaces: ["packages/*"] }),
    );
    await write(root, "packages/tool/package.json", JSON.stringify({ name: "@fixture/tool" }));
    await write(root, "packages/tool/src/index.ts", "export const build = () => {};\n");
    const host = {
      name: "@fixture/host",
      files: ["src"],
      exports: "./src/index.ts",
      devDependencies: { "@fixture/tool": "workspace:*" },
    };
    await write(
      root,
      "packages/host/scripts/build.ts",
      'import "@fixture/tool"; export type Build = string;\n',
    );
    for (const mode of [
      "runtime",
      "type",
      "transitive",
      "published",
      "entrypoint",
      "glob",
      "unknown",
    ] as const) {
      await write(
        root,
        "packages/host/package.json",
        JSON.stringify({
          ...host,
          files:
            mode === "published"
              ? ["src", "scripts"]
              : mode === "glob"
                ? ["**/*"]
                : mode === "unknown"
                  ? undefined
                  : host.files,
          exports: mode === "entrypoint" ? "./scripts/build.ts" : host.exports,
        }),
      );
      const source =
        mode === "runtime"
          ? 'import "../scripts/build";\n'
          : mode === "type"
            ? 'import type { Build } from "../scripts/build"; export type B = Build;\n'
            : mode === "transitive"
              ? 'import "./bridge";\n'
              : "export const host = 1;\n";
      await write(root, "packages/host/src/index.ts", source);
      await write(
        root,
        "packages/host/src/bridge.ts",
        mode === "transitive" ? 'import "../scripts/build";\n' : "export const bridge = 1;\n",
      );
      const findings = (await inspectDependencyPolicy(root)).findings;
      expect(findings.some((f) => f.ruleId === REPO_DEPENDENCY_RULE_IDS.runtimeDeclaration)).toBe(
        true,
      );
      expect(
        findings.some((f) => f.ruleId === REPO_DEPENDENCY_RULE_IDS.developmentDeclaration),
      ).toBe(false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace subpath imports cannot hide a production dependency in unpublished scripts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-script-subpath-"));
  try {
    await write(
      root,
      "package.json",
      JSON.stringify({ private: true, workspaces: ["packages/*"] }),
    );
    await write(root, "packages/tool/package.json", JSON.stringify({ name: "@fixture/tool" }));
    await write(root, "packages/tool/src/index.ts", "export const build = () => {};\n");
    await write(
      root,
      "packages/host/package.json",
      JSON.stringify({
        name: "@fixture/host",
        files: ["src"],
        devDependencies: { "@fixture/tool": "workspace:*" },
      }),
    );
    await write(root, "packages/host/src/index.ts", "export const host = 1;\n");
    await write(root, "packages/host/scripts/build.ts", 'import "@fixture/tool";\n');
    await write(
      root,
      "packages/consumer/package.json",
      JSON.stringify({
        name: "@fixture/consumer",
        dependencies: { "@fixture/host": "workspace:*" },
      }),
    );
    await write(root, "packages/consumer/src/index.ts", 'import "@fixture/host/scripts/build";\n');
    expect((await inspectDependencyPolicy(root)).findings).toContainEqual(
      expect.objectContaining({
        path: "packages/host/package.json",
        ruleId: REPO_DEPENDENCY_RULE_IDS.runtimeDeclaration,
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.dependencies does not require runtime declarations for generated Rempts profile imports", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-dependencies-profile-"));
  try {
    await write(
      root,
      "package.json",
      JSON.stringify({ private: true, workspaces: ["apps/*", "packages/*"] }),
    );
    await write(root, "apps/host/package.json", JSON.stringify({ name: "@fixture/host" }));
    await write(
      root,
      "packages/plugin/package.json",
      JSON.stringify({ name: "@reliverse/fixture-plugin" }),
    );
    await write(root, "packages/plugin/src/index.ts", "export default {};\n");
    await write(
      root,
      "apps/host/src/rempts/generated-profile.mjs",
      'import plugin from "@reliverse/fixture-plugin";\nexport default plugin;\n',
    );

    const report = await inspectDependencyPolicy(root);
    expect(report.findings).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.dependencies reports one deterministic path for a manifest plus source package cycle", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-dependencies-package-cycle-"));
  try {
    await write(
      root,
      "package.json",
      JSON.stringify({ private: true, workspaces: ["packages/*"] }),
    );
    await write(
      root,
      "packages/a/package.json",
      JSON.stringify({ name: "@fixture/a", dependencies: { "@fixture/b": "workspace:*" } }),
    );
    await write(root, "packages/a/src/index.ts", "export const a = 1;\n");
    await write(root, "packages/b/package.json", JSON.stringify({ name: "@fixture/b" }));
    await write(root, "packages/b/src/index.ts", 'export { a } from "@fixture/a";\n');

    const report = await inspectDependencyPolicy(root);
    const cycle = report.findings.find(
      (finding) => finding.ruleId === REPO_DEPENDENCY_RULE_IDS.runtimeCycle,
    );
    expect(cycle?.message).toContain("@fixture/a -> @fixture/b -> @fixture/a");
    expect(cycle?.data).toEqual({
      cycle: ["@fixture/a", "@fixture/b", "@fixture/a"],
      packages: ["@fixture/a", "@fixture/b"],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.dependencies detects a source-only workspace package cycle", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-dependencies-source-cycle-"));
  try {
    await write(
      root,
      "package.json",
      JSON.stringify({ private: true, workspaces: ["packages/*"] }),
    );
    await write(root, "packages/a/package.json", JSON.stringify({ name: "@fixture/a" }));
    await write(root, "packages/a/src/index.ts", 'export { b } from "@fixture/b";\n');
    await write(root, "packages/b/package.json", JSON.stringify({ name: "@fixture/b" }));
    await write(root, "packages/b/src/index.ts", 'export { a } from "@fixture/a";\n');

    const report = await inspectDependencyPolicy(root);
    const cycle = report.findings.find(
      (finding) => finding.ruleId === REPO_DEPENDENCY_RULE_IDS.runtimeCycle,
    );
    expect(cycle?.data).toEqual({
      cycle: ["@fixture/a", "@fixture/b", "@fixture/a"],
      packages: ["@fixture/a", "@fixture/b"],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.dependencies rejects package-to-app/plugin back-edges while allowing app fan-in", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-dependencies-layer-"));
  try {
    await write(
      root,
      "package.json",
      JSON.stringify({
        private: true,
        workspaces: ["apps/*", "extensions/plugins/*", "packages/*"],
      }),
    );
    await write(
      root,
      "apps/host/package.json",
      JSON.stringify({
        name: "@fixture/host-cli",
        dependencies: { "@fixture/core": "workspace:*", "@fixture/leaf": "workspace:*" },
      }),
    );
    await write(
      root,
      "apps/host/src/index.ts",
      'import "@fixture/core"; import "@fixture/leaf";\n',
    );
    await write(
      root,
      "extensions/plugins/widget/package.json",
      JSON.stringify({ name: "@fixture/widget-plugin" }),
    );
    await write(root, "extensions/plugins/widget/src/index.ts", "export const widget = 1;\n");
    await write(
      root,
      "packages/core/package.json",
      JSON.stringify({
        name: "@fixture/core",
        dependencies: { "@fixture/widget-plugin": "workspace:*" },
      }),
    );
    await write(root, "packages/core/src/index.ts", 'import "@fixture/widget-plugin";\n');
    await write(root, "packages/leaf/package.json", JSON.stringify({ name: "@fixture/leaf" }));
    await write(root, "packages/leaf/src/index.ts", "export const leaf = 1;\n");

    const report = await inspectDependencyPolicy(root);
    const directions = report.findings.filter(
      (finding) => finding.ruleId === REPO_DEPENDENCY_RULE_IDS.layerDirection,
    );
    expect(directions).toHaveLength(1);
    expect(directions[0]?.path).toBe("packages/core/package.json");
    expect(directions[0]?.message).toContain("@fixture/widget-plugin");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.dependencies warns on dynamic package-local cycles and accepts only an exact reviewed exception", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-dependencies-module-cycle-"));
  try {
    await write(
      root,
      "package.json",
      JSON.stringify({ private: true, workspaces: ["packages/*"] }),
    );
    await write(root, "packages/a/package.json", JSON.stringify({ name: "@fixture/a" }));
    await write(root, "packages/a/src/a.ts", 'export const load = () => import("./b");\n');
    await write(root, "packages/a/src/b.ts", 'export { load } from "./a";\n');

    const report = await inspectDependencyPolicy(root);
    const moduleCycle = report.findings.find(
      (finding) => finding.ruleId === REPO_DEPENDENCY_RULE_IDS.moduleCycle,
    );
    expect(moduleCycle?.message).toContain(
      "packages/a/src/a.ts -> packages/a/src/b.ts -> packages/a/src/a.ts",
    );

    const excepted = await inspectDependencyPolicy(root, {
      moduleCycleExceptions: [
        {
          createdAt: "2026-09-12",
          files: ["packages/a/src/a.ts", "packages/a/src/b.ts"],
          owner: "fixture-owner",
          packageName: "@fixture/a",
          reason: "fixture proves exact matching",
          reviewCondition: "remove with fixture",
          risk: "fixture-only initialization order",
        },
      ],
    });
    expect(
      excepted.findings.some((finding) => finding.ruleId === REPO_DEPENDENCY_RULE_IDS.moduleCycle),
    ).toBe(false);
    expect(excepted.metadata).toEqual(expect.objectContaining({ exceptedModuleCycles: 1 }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
