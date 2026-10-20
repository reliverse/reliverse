import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  runQualityApply,
  runQualityCheck,
  runQualityPlan,
  type QualityCheckContext,
} from "@reliverse/quality";
import { defineQualitySuiteContractTests } from "@reliverse/quality-testkit/bun";
import {
  getRemptsQualitySuites,
  QUALITY_SUITE_CONTRIBUTION_POINT,
} from "@reliverse/quality/rempts";
import { createRemptsPluginAPI, hasRemptsPluginCommandSurface } from "@reliverse/rempts";

import plugin from "./index";
import { withRepositoryPublicationScope } from "./shared/diagnostics";
import { repoQualitySuite } from "./suite";

test("publication scoping preserves root and cross-package blockers and exposes omitted findings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-publication-scope-"));
  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: ["packages/*"] }),
    );
    for (const name of ["owned", "other"]) {
      await mkdir(path.join(root, "packages", name), { recursive: true });
      await writeFile(
        path.join(root, "packages", name, "package.json"),
        JSON.stringify({ name: "@fixture/" + name }),
      );
    }
    const context: QualityCheckContext = {
      suite: repoQualitySuite.manifest,
      capability: repoQualitySuite.manifest.capabilities.find((c) => c.id === "repo.dependencies")!,
      target: { kind: "repository", id: "fixture", root },
      config: null,
      input: { publicationScope: { paths: ["packages/owned"] } },
    };
    const check = withRepositoryPublicationScope(async () => ({
      diagnostics: [
        {
          ruleId: "repo.dependencies.runtime-declaration",
          message: "owned",
          path: "packages/owned/package.json",
        },
        {
          ruleId: "repo.dependencies.runtime-declaration",
          message: "unrelated",
          path: "packages/other/package.json",
        },
        { ruleId: "repo.dependencies.runtime-declaration", message: "root", path: "package.json" },
        {
          ruleId: "repo.dependencies.runtime-cycle",
          message: "related cycle",
          path: "packages/other/package.json",
          data: { packages: ["@fixture/other", "@fixture/owned"] },
        },
        { ruleId: "repo.dependencies.runtime-declaration", message: "global" },
      ],
    }));
    const result = await check(context);
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      "owned",
      "root",
      "related cycle",
      "global",
    ]);
    expect(result.metadata).toMatchObject({ publicationScope: { omittedDiagnostics: 1 } });
    for (const paths of [[], ["."], ["../other"], ["**/*"], ["/absolute"]])
      await expect(check({ ...context, input: { publicationScope: { paths } } })).rejects.toThrow(
        "exact",
      );
    expect((await check({ ...context, input: null })).diagnostics).toHaveLength(5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function git(root: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn(["git", "-c", "color.ui=false", "-c", "core.pager=cat", ...args], {
    cwd: root,
    env: {
      ...globalThis.process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_PAGER: "cat",
      PAGER: "cat",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    Bun.readableStreamToText(child.stdout),
    Bun.readableStreamToText(child.stderr),
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout;
}

async function writeManifest(
  root: string,
  relativeDirectory: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  const directory = path.join(root, relativeDirectory);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function createFixtureRepository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "repo-rq-plugin-"));
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "@repo/root",
        private: true,
        workspaces: {
          packages: ["apps/cli/*", "packages/*", "packages/dler/*", "extensions/plugins/*/*"],
        },
      },
      null,
      2,
    )}\n`,
  );

  await Promise.all([
    writeManifest(root, "apps/cli/legacy", {
      name: "@reliverse/legacy",
      version: "0.0.1",
    }),
    writeManifest(root, "packages/good", {
      name: "@reliverse/good-sdk",
      version: "0.0.1",
    }),
    writeManifest(root, "packages/topology", {
      name: "@reliverse/topology-sdk",
      version: "0.0.1",
      scripts: { typecheck: "tsc -p missing.tsconfig.json --noEmit" },
    }),
    writeManifest(root, "packages/dler/family", {
      name: "@reliverse/not-family",
      version: "0.0.1",
      private: false,
      scripts: {},
    }),
    writeManifest(root, "packages/duplicate-a", {
      name: "@reliverse/duplicate-sdk",
      version: "0.0.1",
    }),
    writeManifest(root, "packages/duplicate-b", {
      name: "@reliverse/duplicate-sdk",
      version: "0.0.1",
    }),
    writeManifest(root, "packages/unscoped", {
      name: "unscoped-package",
      version: "0.0.1",
    }),
    writeManifest(root, "packages/missing-reference", {
      name: "@reliverse/missing-reference-sdk",
      version: "0.0.1",
      dependencies: { "@reliverse/not-present": "workspace:*" },
    }),
    writeManifest(root, "packages/self-binding", {
      name: "@reliverse/rse-rse-plugin",
      version: "0.0.1",
    }),
    writeManifest(root, "extensions/plugins/rse/dler", {
      name: "@reliverse/plugin-rse-dler",
      version: "0.0.1",
      dependencies: { "@reliverse/rempts": "workspace:*" },
    }),
    writeManifest(root, "extensions/plugins/rq/repo", {
      name: "@reliverse/repo-rq-plugin",
      version: "0.0.1",
      dependencies: { "@reliverse/rempts": "workspace:*" },
    }),
    writeManifest(root, "extensions/plugins/rvs/bad", {
      name: "@reliverse/bad-rse-plugin",
      version: "0.0.1",
      dependencies: { "@reliverse/rempts": "workspace:*" },
    }),
    writeManifest(root, "extensions/plugins/rse/no-rempts", {
      name: "@reliverse/no-rempts-rse-plugin",
      version: "0.0.1",
    }),
    writeManifest(root, "extensions/plugins/ghost/foo", {
      name: "@reliverse/foo-ghost-plugin",
      version: "0.0.1",
      dependencies: { "@reliverse/rempts": "workspace:*" },
    }),
  ]);
  await Promise.all([
    mkdir(path.join(root, "fixtures"), { recursive: true }),
    mkdir(path.join(root, "packages/good/src"), { recursive: true }),
    mkdir(path.join(root, "packages/duplicate-a/src"), { recursive: true }),
    mkdir(path.join(root, "extensions/plugins/rse/dler/src/cmds/broken"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(root, "fixtures/legacy.json"), "{}\n"),
    writeFile(path.join(root, "packages/duplicate-a/src/value.ts"), "export const value = 1;\n"),
    writeFile(
      path.join(root, "packages/good/src/index.ts"),
      'import "@reliverse/duplicate-sdk";\nexport { value } from "../../duplicate-a/src/value.ts";\n',
    ),
    writeFile(
      path.join(root, "packages/good/tsconfig.json"),
      '{"extends":"./unsupported.json","compilerOptions":{"allowImportingTsExtensions":true}}\n',
    ),
    writeFile(
      path.join(root, "packages/good/src/retired-command.ts"),
      'export const retiredCommand = "rse' + ' nc";\n',
    ),
    writeFile(
      path.join(root, "extensions/plugins/rse/dler/src/index.ts"),
      'import { definePlugin } from "@reliverse/rempts";\nexport default definePlugin({ name: "dler" });\n',
    ),
    writeFile(
      path.join(root, "extensions/plugins/rse/dler/src/cmds/broken/cmd.ts"),
      'export const command = "broken";\n',
    ),
  ]);
  await git(root, ["init", "--quiet"]);
  await git(root, ["add", "--all"]);
  return root;
}

const fixtureRoot = await createFixtureRepository();
afterAll(async () => rm(fixtureRoot, { force: true, recursive: true }));

const fixtureRequest = {
  capabilityId: "repo.naming",
  target: {
    kind: "repository",
    id: "repo-rq-plugin-fixture",
    root: fixtureRoot,
  },
  grantedEffects: ["filesystem.read", "git.read", "process.spawn"],
} as const;

const repositoryCapabilities = [
  "repo.agent-harness",
  "repo.complexity",
  "repo.naming",
  "repo.packages",
  "repo.dependencies",
  "repo.rvs-domains",
  "repo.boundaries",
  "repo.topology",
  "repo.tsconfig",
  "repo.fixtures",
  "repo.cli",
  "repo.rempts",
  "repo.dcs",
  "repo.tool-bridges",
  "repo.runtime",
  "repo.rse-thin-host",
  "repo.docs",
  "repo.schemas",
  "repo.public-surface-hygiene",
  "repo.specs",
  "repo.lockfile",
  "repo.type-supply",
  "repo.paths",
  "repo.concepts",
] as const;

defineQualitySuiteContractTests(() => repoQualitySuite, {
  checks: repositoryCapabilities.map((capabilityId) => ({
    id: `${capabilityId} fixture`,
    request: { ...fixtureRequest, capabilityId },
  })),
  plans: [
    {
      id: "repo.naming plan fixture",
      request: {
        ...fixtureRequest,
        capabilityId: "repo.naming",
        producer: { pluginId: "repo-rq-plugin", packageName: "@reliverse/repo-rq-plugin" },
      },
      expectedOperationCount: 1,
    },
  ],
});

async function createAtomicNamingFixture(): Promise<{
  readonly consumerManifestPath: string;
  readonly importPath: string;
  readonly legacyManifestPath: string;
  readonly root: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "repo-rq-naming-plan-"));
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "@fixture/naming-plan",
        private: true,
        workspaces: ["extensions/plugins/rse/*", "packages/*"],
      },
      null,
      2,
    )}\n`,
  );
  await Promise.all([
    writeManifest(root, "extensions/plugins/rse/example", {
      name: "@reliverse/plugin-rse-example",
      version: "0.0.1",
    }),
    writeManifest(root, "packages/consumer", {
      name: "@reliverse/consumer",
      version: "0.0.1",
      dependencies: { "@reliverse/plugin-rse-example": "workspace:*" },
    }),
    mkdir(path.join(root, "packages/consumer/src"), { recursive: true }),
    mkdir(path.join(root, "!handoff"), { recursive: true }),
    mkdir(path.join(root, "docs/evidence"), { recursive: true }),
    mkdir(path.join(root, "packages/naming/src"), { recursive: true }),
  ]);
  const importPath = path.join(root, "packages/consumer/src/index.ts");
  await Promise.all([
    writeFile(importPath, 'import "@reliverse/plugin-rse-example";\n'),
    writeFile(path.join(root, "!handoff/history.md"), "@reliverse/plugin-rse-example\n"),
    writeFile(
      path.join(root, "docs/evidence/package-naming-inventory-v0.md"),
      "@reliverse/plugin-rse-example\n",
    ),
    writeFile(
      path.join(root, "packages/naming/src/extensions.ts"),
      'export const legacy = "@reliverse/plugin-rse-example";\n',
    ),
    writeFile(
      path.join(root, "packages/naming/src/index.test.ts"),
      'const fixture = "@reliverse/plugin-rse-example";\n',
    ),
  ]);
  return {
    root,
    importPath,
    legacyManifestPath: path.join(root, "extensions/plugins/rse/example/package.json"),
    consumerManifestPath: path.join(root, "packages/consumer/package.json"),
  };
}

async function snapshotRepository(root: string): Promise<Readonly<Record<string, string>>> {
  const snapshot: Record<string, string> = {};
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile()) {
        snapshot[path.relative(root, candidate).replaceAll("\\", "/")] = await readFile(
          candidate,
          "utf8",
        );
      }
    }
  }
  await visit(root);
  return snapshot;
}

describe("repository quality suite", () => {
  test("reports stable rule families over a synthetic workspace", async () => {
    const result = await runQualityCheck(repoQualitySuite, fixtureRequest);
    const ruleIds = new Set(result.diagnostics.map((entry) => entry.ruleId));

    expect(ruleIds).toContain("repo.naming.legacy-pattern");
    expect(ruleIds).toContain("repo.naming.package-collision");
    expect(ruleIds).toContain("repo.naming.package-shape");
    expect(ruleIds).toContain("repo.naming.directory-alignment");
    expect(ruleIds).toContain("repo.naming.plugin-contract");
    expect(ruleIds).toContain("repo.naming.workspace-references");
    expect(ruleIds).toContain("repo.naming.binding-known");
    expect(ruleIds).toContain("repo.naming.self-binding");
    expect(result.summary.error).toBeGreaterThan(0);
    expect(result.metadata).toMatchObject({
      legacyExtensionCount: 1,
      workspaceCount: 14,
    });
  });

  test("reports migrated repository policy rule families", async () => {
    const expectedRules = {
      "repo.packages": "repo.packages.family-name",
      "repo.dependencies": "repo.dependencies.runtime-declaration",
      "repo.boundaries": "repo.boundaries.relative-workspace-import",
      "repo.topology": "repo.topology.config-exists",
      "repo.tsconfig": "repo.tsconfig.shared-preset",
      "repo.fixtures": "repo.fixtures.shared-location",
      "repo.cli": "repo.cli.package-identity",
      "repo.rempts": "repo.rempts.plugin-mount",
      "repo.dcs": "repo.dcs.owner-registration",
      "repo.tool-bridges": "repo.tool-bridges.structured-transport",
      "repo.runtime": "repo.runtime.sot",
      "repo.docs": "repo.docs.catalog-version",
      "repo.lockfile": "repo.lockfile.present",
      "repo.type-supply": "repo.type-supply.catalog-pin",
      "repo.paths": "repo.paths.canonical-path",
      "repo.concepts": "repo.concepts.retired-rse-nc",
    } as const;

    for (const [capabilityId, ruleId] of Object.entries(expectedRules)) {
      const result = await runQualityCheck(repoQualitySuite, {
        ...fixtureRequest,
        capabilityId,
      });
      expect(result.diagnostics.map((entry) => entry.ruleId)).toContain(ruleId);
      expect(result.summary.error).toBeGreaterThan(0);
    }
  });

  test("returns a truthful no-op plan after canonical migration", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "repo-rq-canonical-plan-"));
    try {
      await writeFile(
        path.join(root, "package.json"),
        `${JSON.stringify(
          {
            name: "@fixture/canonical-plan",
            private: true,
            workspaces: ["extensions/plugins/rse/*"],
          },
          null,
          2,
        )}\n`,
      );
      await writeManifest(root, "extensions/plugins/rse/example", {
        name: "@reliverse/example-rse-plugin",
        version: "0.0.1",
      });
      await mkdir(path.join(root, "extensions/plugins/rq/repo/src"), { recursive: true });
      await writeFile(
        path.join(root, "extensions/plugins/rq/repo/src/config.ts"),
        "export const legacyAllowedNames = [];\n",
      );
      const result = await runQualityPlan(repoQualitySuite, {
        capabilityId: "repo.naming",
        target: { kind: "repository", id: "canonical-naming-fixture", root },
        producer: { pluginId: "repo-rq-plugin", packageName: "@reliverse/repo-rq-plugin" },
        grantedEffects: ["filesystem.read"],
      });
      expect(result.plan.operations).toHaveLength(0);
      expect(result.plan.manualItems).toHaveLength(0);
      expect(result.plan.risks).toHaveLength(0);
      expect(result.plan.applicable).toBe(false);
      expect(result.metadata).toMatchObject({ candidates: 0, operationFiles: 0 });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("plans classified package references atomically and rejects drift before mutation", async () => {
    const fixture = await createAtomicNamingFixture();
    try {
      const request = {
        capabilityId: "repo.naming",
        target: { kind: "repository", id: "atomic-naming-fixture", root: fixture.root },
        producer: { pluginId: "repo-rq-plugin", packageName: "@reliverse/repo-rq-plugin" },
        grantedEffects: ["filesystem.read"],
      } as const;
      const result = await runQualityPlan(repoQualitySuite, request);
      const operationPaths = new Set(
        result.plan.operations.map((operation) =>
          "path" in operation ? operation.path : operation.from,
        ),
      );
      expect(result.plan.applicable).toBe(true);
      expect(result.plan.manualItems).toHaveLength(0);
      expect(operationPaths).toContain("extensions/plugins/rse/example/package.json");
      expect(operationPaths).toContain("packages/consumer/package.json");
      expect(operationPaths).toContain("packages/consumer/src/index.ts");
      expect(operationPaths).not.toContain("!handoff/history.md");
      expect(operationPaths).not.toContain("docs/evidence/package-naming-inventory-v0.md");
      expect(operationPaths).not.toContain("packages/naming/src/extensions.ts");
      expect(operationPaths).not.toContain("packages/naming/src/index.test.ts");
      expect(result.metadata).toMatchObject({
        candidates: 1,
        excludedReferences: {
          generated: 1,
          historical: 1,
          "intentional-legacy-fixture": 1,
          "migration-policy": 1,
        },
        generatedEvidencePolicy: "regenerate-after-source-migration",
      });

      const legacyManifestBefore = await readFile(fixture.legacyManifestPath, "utf8");
      const consumerManifestBefore = await readFile(fixture.consumerManifestPath, "utf8");
      const driftedImport = 'import "@reliverse/plugin-rse-example";\n// drift\n';
      await writeFile(fixture.importPath, driftedImport);
      const receipt = await runQualityApply(repoQualitySuite, {
        plan: result.plan,
        targetRoot: fixture.root,
        targetId: "atomic-naming-fixture",
        authorization: { kind: "trusted-caller", source: "suite-test" },
        grantedEffects: [
          "filesystem.delete",
          "filesystem.read",
          "filesystem.rename",
          "filesystem.write",
        ],
        runId: "atomic-naming-drift",
        createdAt: "2026-07-26T00:00:00.000Z",
      });
      expect(receipt.status).toBe("failed");
      expect(receipt.preflight.status).toBe("failed");
      expect(receipt.operations.every((operation) => operation.status === "not-run")).toBe(true);
      expect(await readFile(fixture.legacyManifestPath, "utf8")).toBe(legacyManifestBefore);
      expect(await readFile(fixture.consumerManifestPath, "utf8")).toBe(consumerManifestBefore);
      expect(await readFile(fixture.importPath, "utf8")).toBe(driftedImport);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  test("keeps every repository check read-only", async () => {
    const before = await snapshotRepository(fixtureRoot);
    for (const capabilityId of repositoryCapabilities) {
      await runQualityCheck(repoQualitySuite, { ...fixtureRequest, capabilityId });
    }
    await runQualityPlan(repoQualitySuite, {
      ...fixtureRequest,
      capabilityId: "repo.naming",
      producer: { pluginId: "repo-rq-plugin", packageName: "@reliverse/repo-rq-plugin" },
    });
    expect(await snapshotRepository(fixtureRoot)).toEqual(before);
  });

  test("applies DCS-projected naming policy to diagnostic severity", async () => {
    const result = await runQualityCheck(repoQualitySuite, {
      ...fixtureRequest,
      config: {
        naming: {
          atomicFamilies: [],
          legacyAllowedNames: ["@reliverse/plugin-rse-dler"],
          legacySeverity: "info",
          scopeOverrides: {},
        },
      },
    });
    const legacy = result.diagnostics.find(
      (entry) => entry.ruleId === "repo.naming.legacy-pattern",
    );
    expect(legacy?.severity).toBe("info");
  });

  test("rejects a legacy extension outside the migration baseline", async () => {
    const result = await runQualityCheck(repoQualitySuite, {
      ...fixtureRequest,
      config: {
        naming: {
          atomicFamilies: [],
          legacyAllowedNames: [],
          legacySeverity: "warning",
          scopeOverrides: {},
        },
      },
    });
    const legacy = result.diagnostics.find(
      (entry) => entry.ruleId === "repo.naming.legacy-pattern",
    );
    expect(legacy?.severity).toBe("error");
  });

  test("is a headless Rempts plugin with one owned quality contribution", () => {
    expect(hasRemptsPluginCommandSurface(plugin)).toBe(false);
    expect(plugin.config?.namespace).toBe("repo");
    const api = createRemptsPluginAPI({
      plugins: [plugin],
      contributionPoints: [QUALITY_SUITE_CONTRIBUTION_POINT],
    });
    const suites = getRemptsQualitySuites(api);

    expect(suites).toHaveLength(1);
    expect(suites[0]?.owner.name).toBe("repo-rq-plugin");
    expect(suites[0]?.contribution.runtime).toBe(repoQualitySuite);
  });
});
