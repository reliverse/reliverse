import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { defineDcsOwner, discoverDcsOwnerConfig } from "./owner-discovery";

const temporaryRoots: string[] = [];
async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "dcs-owner-discovery-"));
  temporaryRoots.push(root);
  return root;
}
async function file(root: string, relative: string): Promise<string> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "{}\n");
  return target;
}

const rse = defineDcsOwner({ owner: "rse", basename: "rse", profiles: ["production"] });

test("product roots discover config/schema filenames without portable owner-name aliases", async () => {
  const root = await fixture();
  await file(root, "config.json"); await file(root, "schema.json");
  await file(root, "config.production.json"); await file(root, ".config/rse.json");
  const scopes = [{ root, scope: "user" as const, layout: "product" as const }];
  const result = await discoverDcsOwnerConfig({ owner: rse, scopes });
  expect(result.ok).toBe(true);
  expect(result.active?.path).toBe(path.join(root, "config.json"));
  expect(result.activeSchema?.path).toBe(path.join(root, "schema.json"));
  expect(result.canonicalPathByScope.user).toBe(path.join(root, "config.json"));
  expect(result.canonicalSchemaPathByScope.user).toBe(path.join(root, "schema.json"));
  expect(result.profiles.map(entry => entry.profile)).toEqual(["production"]);
  expect(result.mainCandidates).toHaveLength(1);
  await file(root, "config.jsonc");
  expect((await discoverDcsOwnerConfig({ owner: rse, scopes })).ok).toBe(false);
});

test("discovers directory and root JSON/JSONC spellings deterministically", async () => {
  const layouts = [
    ".config/rse.json",
    ".config/rse.config.jsonc",
    ".config/rse.yaml",
    "rse.json",
    "rse.config.jsonc",
  ];
  for (const layout of layouts) {
    const root = await fixture();
    await file(root, layout);
    const result = await discoverDcsOwnerConfig({
      owner: rse,
      scopes: [{ root, scope: "repository" }],
    });
    expect(result.ok).toBe(true);
    expect(result.active?.path).toBe(path.join(root, layout));
    expect(result.active?.kind).toBe("main");
  }
});

test("discovers current repository owner layouts and keeps schemas out of main ambiguity", async () => {
  const root = await fixture();
  await file(root, ".config/rse.json");
  await file(root, ".config/schema/rse.json");
  await file(root, ".config/rse.production.json");
  const result = await discoverDcsOwnerConfig({
    owner: rse,
    scopes: [{ root, scope: "repository" }],
  });
  expect(result.ok).toBe(true);
  expect(result.mainCandidates).toHaveLength(1);
  expect(result.schemas).toHaveLength(1);
  expect(result.activeSchema?.path).toBe(path.join(root, ".config/schema/rse.json"));
  expect(result.canonicalSchemaPathByScope.repository).toBe(
    path.join(root, ".config/schema/rse.json"),
  );
  expect(result.profiles.map((entry) => entry.profile)).toEqual(["production"]);
});

test("allows the alternate adjacent directory schema when it is the only projection", async () => {
  const root = await fixture();
  await file(root, ".config/rse.json");
  await file(root, ".config/rse.schema.json");
  const result = await discoverDcsOwnerConfig({
    owner: rse,
    scopes: [{ root, scope: "repository" }],
  });
  expect(result.ok).toBe(true);
  expect(result.activeSchema?.path).toBe(path.join(root, ".config/rse.schema.json"));
  expect(result.canonicalSchemaPathByScope.repository).toBe(
    path.join(root, ".config/schema/rse.json"),
  );
});

test("classifies a root schema alias without treating it as main config", async () => {
  const root = await fixture();
  await file(root, "rse.config.json");
  await file(root, "rse.schema.json");
  const result = await discoverDcsOwnerConfig({
    owner: rse,
    scopes: [{ root, scope: "repository" }],
  });
  expect(result.ok).toBe(true);
  expect(result.mainCandidates).toHaveLength(1);
  expect(result.activeSchema?.layout).toBe("root");
});

test("fails fast for competing main candidates in one scope", async () => {
  const root = await fixture();
  await file(root, ".config/rse.json");
  await file(root, "rse.config.jsonc");
  const result = await discoverDcsOwnerConfig({
    owner: rse,
    scopes: [{ root, scope: "repository" }],
  });
  expect(result.ok).toBe(false);
  expect(result.active).toBeUndefined();
  expect(result.diagnostics[0]?.code).toBe("DCS_CONFIG_AMBIGUOUS");
  expect(result.diagnostics[0]?.paths).toHaveLength(2);
});

test("explicit path remains active while implicit ambiguity stays visible", async () => {
  const root = await fixture();
  await file(root, ".config/rse.json");
  await file(root, "rse.config.jsonc");
  const explicitPath = await file(root, "custom/selected.yaml");
  const result = await discoverDcsOwnerConfig({
    explicitPath,
    owner: rse,
    scopes: [{ root, scope: "repository" }],
  });
  expect(result.active?.path).toBe(explicitPath);
  expect(result.active?.provenance).toBe("explicit");
  expect(result.diagnostics.some((entry) => entry.code === "DCS_CONFIG_AMBIGUOUS")).toBe(true);
});

test("allows distinct package, repository, and user scope documents", async () => {
  const user = await fixture();
  const repository = await fixture();
  const packageRoot = await fixture();
  await file(user, ".config/rse.json");
  await file(repository, ".config/rse.json");
  await file(packageRoot, ".config/rse.json");
  const result = await discoverDcsOwnerConfig({
    owner: rse,
    scopes: [
      { root: user, scope: "user" },
      { root: repository, scope: "repository" },
      { root: packageRoot, scope: "package" },
    ],
  });
  expect(result.ok).toBe(true);
  expect(result.mainCandidates).toHaveLength(3);
  expect(result.active?.scope).toBe("package");
});

test("supports basename aliases and reports duplicate schema projections", async () => {
  const root = await fixture();
  const owner = defineDcsOwner({
    owner: "rpr-toolchain",
    basename: "nc",
    aliases: ["rpr-toolchain"],
  });
  await file(root, ".config/rpr-toolchain.json");
  await file(root, ".config/schema/nc.json");
  await file(root, ".config/nc.schema.json");
  const result = await discoverDcsOwnerConfig({ owner, scopes: [{ root, scope: "repository" }] });
  expect(result.active?.basename).toBe("nc");
  expect(result.diagnostics.some((entry) => entry.code === "DCS_DUPLICATE_SCHEMA_PROJECTION")).toBe(
    true,
  );
  expect(result.activeSchema).toBeUndefined();
});

test("discovers owner TypeScript config without executing it and requires trust to activate", async () => {
  const root = await fixture();
  await file(root, ".config/nc.config.ts");
  const owner = defineDcsOwner({
    owner: "rpr-toolchain",
    basename: "nc",
    formats: ["ts"],
    generation: { defaultFormat: "ts", directoryIncludesConfigSegment: true },
  });
  const blocked = await discoverDcsOwnerConfig({ owner, scopes: [{ root, scope: "repository" }] });
  expect(blocked.active?.trustedCode).toBe(true);
  expect(blocked.diagnostics[0]?.code).toBe("DCS_TS_CONFIG_TRUST_REQUIRED");
  const trusted = await discoverDcsOwnerConfig({
    allowTrustedTypeScript: true,
    owner,
    scopes: [{ root, scope: "repository" }],
  });
  expect(trusted.ok).toBe(true);
});

test("reports missing explicit paths and unsupported formats", async () => {
  const root = await fixture();
  const missing = await discoverDcsOwnerConfig({
    explicitPath: path.join(root, "missing.json"),
    owner: rse,
    scopes: [{ root, scope: "repository" }],
  });
  expect(missing.diagnostics[0]?.code).toBe("DCS_EXPLICIT_CONFIG_MISSING");
  const unsupportedPath = await file(root, "rse.toml");
  const unsupported = await discoverDcsOwnerConfig({
    explicitPath: unsupportedPath,
    owner: rse,
    scopes: [{ root, scope: "repository" }],
  });
  expect(unsupported.diagnostics[0]?.code).toBe("DCS_UNSUPPORTED_CONFIG_FORMAT");
});

test("missing optional configuration is a successful empty plan", async () => {
  const root = await fixture();
  const result = await discoverDcsOwnerConfig({
    owner: rse,
    scopes: [{ root, scope: "repository" }],
  });
  expect(result.ok).toBe(true);
  expect(result.active).toBeUndefined();
  expect(result.canonicalPathByScope.repository).toBe(path.join(root, ".config/rse.json"));
  expect(result.canonicalSchemaPathByScope.repository).toBe(
    path.join(root, ".config/schema/rse.json"),
  );
});

test("keeps root-layout config and schema generation adjacent", async () => {
  const root = await fixture();
  const rootOwner = defineDcsOwner({
    owner: "rse",
    basename: "rse",
    generation: { defaultLayout: "root" },
  });
  const result = await discoverDcsOwnerConfig({
    owner: rootOwner,
    scopes: [{ root, scope: "repository" }],
  });
  expect(result.canonicalPathByScope.repository).toBe(path.join(root, "rse.config.json"));
  expect(result.canonicalSchemaPathByScope.repository).toBe(path.join(root, "rse.schema.json"));
});

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { force: true, recursive: true })));
});
