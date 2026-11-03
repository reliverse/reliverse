import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createConfigContractBundle } from "@reliverse/dcs-contract";

import { createDcsHostConfigProvider } from "./host-provider";
import { defineDcsOwner } from "./owner-discovery";

const bundle = createConfigContractBundle({
  $dcs: {
    contractVersion: 1,
    documentVersion: 1,
    fileStem: "demo",
    id: "org.reliverse.demo",
    specVersion: "0.0.1",
  },
  defaults: { enabled: true, mode: "safe" },
  fields: {
    "/enabled": { merge: "replace", scopes: ["user", "workspace", "local"] },
    "/mode": { merge: "replace", scopes: ["user", "workspace", "local"] },
  },
  schema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    properties: { enabled: { type: "boolean" }, mode: { type: "string" } },
    required: ["enabled", "mode"],
    type: "object",
  },
});
const owner = defineDcsOwner({ owner: "demo", basename: "demo", formats: ["json", "jsonc"] });

async function root() {
  return mkdtemp(path.join(tmpdir(), "dcs-host-provider-"));
}
async function config(rootPath: string, relative: string, value: unknown) {
  const target = path.join(rootPath, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}
function input(
  repository: string,
  cwd = repository,
  env: Record<string, string> = {},
  globalConfigPath = "/unused",
) {
  return { cwd, env, paths: { globalConfigPath, workspaceRoot: repository } };
}

test("host provider resolves total defaults when config is absent", async () => {
  const repository = await root();
  try {
    const result = await createDcsHostConfigProvider({ bundle, owner }).resolve(input(repository));
    expect(result.ok).toBe(true);
    expect(result.resolved?.value).toEqual({ enabled: true, mode: "safe" });
  } finally {
    await rm(repository, { force: true, recursive: true });
  }
});

test("default host provider includes configured user path before repository and package", async () => {
  const user = await root();
  const repository = await root();
  const packageRoot = path.join(repository, "packages/example");
  try {
    await config(user, "demo.config.jsonc", { enabled: false, mode: "user" });
    await config(repository, ".config/demo.json", { enabled: true, mode: "workspace" });
    await config(packageRoot, ".config/demo.json", { enabled: true, mode: "package" });
    const provider = createDcsHostConfigProvider({ bundle, owner });
    const result = await provider.resolve(
      input(repository, packageRoot, {}, path.join(user, "host.config.jsonc")),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.resolved?.value).toEqual({ enabled: true, mode: "package" });
    expect(result.discovery.candidatePaths).toEqual(
      expect.arrayContaining([
        path.join(user, "demo.config.jsonc"),
        path.join(repository, ".config/demo.json"),
        path.join(packageRoot, ".config/demo.json"),
      ]),
    );
    expect(result.effectiveRevision).toMatch(/^sha256:[a-f0-9]{64}$/);
  } finally {
    await Promise.all(
      [user, repository].map((entry) => rm(entry, { force: true, recursive: true })),
    );
  }
});

test("host provider composes custom user, repository, and package scopes with provenance", async () => {
  const user = await root();
  const repository = await root();
  const packageRoot = path.join(repository, "packages/example");
  try {
    await config(user, ".config/demo.json", { enabled: false, mode: "user" });
    await config(repository, ".config/demo.json", { enabled: true, mode: "workspace" });
    await config(packageRoot, ".config/demo.json", { enabled: true, mode: "package" });
    const provider = createDcsHostConfigProvider({
      bundle,
      owner,
      resolveScopes: () => [
        { root: user, scope: "user" },
        { root: repository, scope: "repository" },
        { root: packageRoot, scope: "package" },
      ],
    });
    const result = await provider.resolve(input(repository, packageRoot));
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.resolved?.value).toEqual({ enabled: true, mode: "package" });
    expect(result.resolved?.provenance["/mode"]?.effectiveSource).toMatchObject({
      kind: "local-document",
    });
  } finally {
    await Promise.all(
      [user, repository].map((entry) => rm(entry, { force: true, recursive: true })),
    );
  }
});

test("explicit path overrides implicit ambiguity without hiding diagnostics", async () => {
  const repository = await root();
  try {
    await config(repository, ".config/demo.json", { enabled: true, mode: "one" });
    await config(repository, "demo.config.jsonc", { enabled: true, mode: "two" });
    const selected = await config(repository, "custom/demo.json", {
      enabled: false,
      mode: "explicit",
    });
    const result = await createDcsHostConfigProvider({ bundle, owner }).resolve(
      input(repository, repository, { DEMO_CONFIG: selected }),
    );
    expect(result.discovery.explicit).toBe(true);
    expect(result.discovery.diagnosticCodes).toContain("DCS_CONFIG_AMBIGUOUS");
    expect(result.ok).toBe(true);
    expect(result.diagnostics.filter((entry) => entry.code !== "DCS_CONFIG_AMBIGUOUS")).toEqual([]);
    expect(result.resolved?.value).toEqual({ enabled: false, mode: "explicit" });
  } finally {
    await rm(repository, { force: true, recursive: true });
  }
});

test("invalid config fails without rewriting authored bytes", async () => {
  const repository = await root();
  try {
    const target = await config(repository, ".config/demo.json", {
      enabled: "invalid",
      mode: "safe",
    });
    const before = await Bun.file(target).text();
    const result = await createDcsHostConfigProvider({ bundle, owner }).resolve(input(repository));
    expect(result.ok).toBe(false);
    expect(await Bun.file(target).text()).toBe(before);
  } finally {
    await rm(repository, { force: true, recursive: true });
  }
});
