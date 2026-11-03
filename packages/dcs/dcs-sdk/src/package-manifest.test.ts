import { expect, test } from "bun:test";

import { projectPackageManifest } from "./package-manifest";

test("inherits root metadata without mutation; exact owning workspace inventory replaces globs", () => {
  const source = {
    name: "real-root",
    version: "1.0.0",
    private: true,
    type: "module",
    packageManager: "bun@1.4.4",
    engines: { bun: ">=1.4" },
    workspaces: { packages: ["packages/*"], catalog: { react: "19.2.0" } },
    overrides: { react: "19.2.0" },
  };
  const before = JSON.stringify(source);
  const result = projectPackageManifest({
    source,
    workspaces: [
      {
        path: "packages/present",
        manifest: { name: "present", dependencies: { react: "catalog:" } },
      },
    ],
  });
  expect(result.blockers).toEqual([]);
  expect(result.manifest).toEqual({
    ...source,
    workspaces: { ...source.workspaces, packages: ["packages/present"] },
  });
  expect(JSON.stringify(source)).toBe(before);
  expect(
    projectPackageManifest({
      source,
      workspaces: [],
      overrides: { name: "public-root", private: false },
    }).manifest.name,
  ).toBe("public-root");
  expect(result.manifest.private).toBe(true);
});

test("root-only missing workspaces are explicit exclusions; package requirements are blockers", () => {
  const source = { dependencies: { internal: "workspace:*", react: "^19" } };
  const result = projectPackageManifest({
    source,
    workspaces: [
      {
        path: "packages/visible",
        manifest: { name: "visible", dependencies: { internal: "workspace:^" } },
      },
    ],
  });
  expect(result.manifest.dependencies).toEqual({ react: "^19" });
  expect(source.dependencies.internal).toBe("workspace:*");
  expect(result.notices.join()).toContain("Excluded root-only");
  expect(result.blockers.join()).toContain("requires missing workspace internal");
});

test("catalog workspace refs, protocols, duplicate names and script review fail conservatively", () => {
  const result = projectPackageManifest({
    source: {
      workspaces: {
        packages: [],
        catalog: { missing: "workspace:*" },
        catalogs: { ui: { react: "19.2.0" } },
      },
      scripts: { prepare: "bun scripts/private-tool.ts" },
    },
    workspaces: [
      {
        path: "packages/a",
        manifest: {
          name: "a",
          dependencies: {
            missing: "catalog:",
            local: "file:../private",
            alias: "npm:react@19",
            react: "catalog:ui",
          },
        },
      },
      {
        path: "packages/b",
        manifest: {
          name: "a",
          dependencies: { remote: "git+https://example.invalid/repo", unknown: "catalog:missing" },
        },
      },
    ],
  });
  expect(result.blockers.join()).toContain("unique package name");
  expect(result.blockers.join()).toContain("requires missing workspace missing");
  expect(result.blockers.join()).toContain("file/link protocols");
  expect(result.blockers.join()).toContain("missing or recursive catalog");
  expect(result.blockers.join()).not.toContain("for alias");
  expect(result.notices.join()).toContain("Review root script prepare");
});

test("absent local root scripts are visibly excluded; unknown scripts still require review", () => {
  const source = {
    private: true,
    scripts: {
      missing: "bun apps/absent/cli.ts",
      unknown: "some-tool --check",
      present: "bun scripts/check.ts",
    },
  };
  const result = projectPackageManifest({
    source,
    workspaces: [],
    publicationPaths: ["scripts/check.ts"],
  });
  expect(result.manifest.scripts).toEqual({
    unknown: source.scripts.unknown,
    present: source.scripts.present,
  });
  expect(result.notices.join()).toContain("Excluded root script missing");
  expect(result.notices.join()).toContain("Review root script unknown");
  expect(source.scripts.missing).toBe("bun apps/absent/cli.ts");
});

test("private/custom registry configuration blocks instead of being certified by public offline resolution", () => {
  expect(
    projectPackageManifest({
      source: { publishConfig: { registry: "https://registry.internal.invalid" } },
      workspaces: [],
    }).blockers.join(),
  ).toContain("private/custom");
  expect(
    projectPackageManifest({
      source: { publishConfig: { registry: "https://registry.npmjs.org/" } },
      workspaces: [],
    }).blockers,
  ).toEqual([]);
});

test("private references and credential-bearing URLs are not accepted", () => {
  for (const description of [
    "/home/operator/private",
    ".private/secret",
    "https://user:pass@example.invalid",
  ])
    expect(
      projectPackageManifest({ source: { description }, workspaces: [] }).blockers.join(),
    ).toContain("private paths or credentials");
});
