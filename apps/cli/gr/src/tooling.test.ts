import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { withRprStorageLock } from "@reliverse/rpr-cli/storage-lock";
import { verifyRprToolchainMaterialization } from "@reliverse/rpr-toolchain-materialization";

import { ensureWorkspaceExecutionRprMaterialization } from "./tooling";

const roots = new Set<string>();
afterAll(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
});

test("workspace execution closure is lock-bound, repository-specific, and preserves workspace links", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gr-workspace-execution-"));
  const rprRoot = await mkdtemp(path.join(tmpdir(), "gr-workspace-rpr-"));
  roots.add(root);
  roots.add(rprRoot);
  await writeFile(path.join(root, "bun.lock"), '{"lockfileVersion":2}\n');
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "@demo/root",
      workspaces: { packages: ["packages/*"] },
      devDependencies: { external: "1.2.3" },
    }),
  );
  await mkdir(
    path.join(
      root,
      "packages",
      "local",
      "node_modules",
      "typescript-api",
      "node_modules",
      "helper-api",
    ),
    { recursive: true },
  );
  await writeFile(
    path.join(root, "packages", "local", "package.json"),
    JSON.stringify({
      name: "@demo/local",
      version: "0.1.0",
      dependencies: { "@demo/worker": "workspace:*", "typescript-api": "npm:typescript@6.0.3" },
    }),
  );
  await writeFile(
    path.join(root, "packages", "local", "node_modules", "typescript-api", "package.json"),
    JSON.stringify({
      name: "typescript",
      version: "6.0.3",
      dependencies: { "helper-api": "npm:helper@4.5.6" },
    }),
  );
  await writeFile(
    path.join(root, "packages", "local", "node_modules", "typescript-api", "index.js"),
    "export const version = '6.0.3';\n",
  );
  await writeFile(
    path.join(
      root,
      "packages",
      "local",
      "node_modules",
      "typescript-api",
      "node_modules",
      "helper-api",
      "package.json",
    ),
    JSON.stringify({ name: "helper", version: "4.5.6" }),
  );
  await writeFile(
    path.join(
      root,
      "packages",
      "local",
      "node_modules",
      "typescript-api",
      "node_modules",
      "helper-api",
      "index.js",
    ),
    "export default 1;\n",
  );
  await mkdir(path.join(root, "packages", "worker"), { recursive: true });
  await writeFile(
    path.join(root, "packages", "worker", "package.json"),
    JSON.stringify({ name: "@demo/worker", version: "0.1.0" }),
  );
  await mkdir(path.join(root, "node_modules", "external"), { recursive: true });
  await writeFile(
    path.join(root, "node_modules", "external", "package.json"),
    JSON.stringify({ name: "external", version: "1.2.3" }),
  );
  await writeFile(path.join(root, "node_modules", "external", "index.js"), "export default 42;\n");
  await mkdir(path.join(root, "packages", "worker", "node_modules", "external"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "packages", "worker", "node_modules", "external", "package.json"),
    JSON.stringify({ name: "external", version: "1.2.3" }),
  );
  await writeFile(
    path.join(root, "packages", "worker", "node_modules", "external", "index.js"),
    "export default 42;\n",
  );
  await writeFile(
    path.join(root, "packages", "worker", "package.json"),
    JSON.stringify({ name: "@demo/worker", version: "0.1.0", dependencies: { external: "1.2.3" } }),
  );

  const first = await ensureWorkspaceExecutionRprMaterialization({ rprRoot, repositoryRoot: root });
  const second = await ensureWorkspaceExecutionRprMaterialization({
    rprRoot,
    repositoryRoot: root,
  });

  expect(second.root).toBe(first.root);
  expect(first.packages).toBe(3);
  expect(first.workspaceLinks).toEqual([
    { packageName: "@demo/local", repositoryPath: "packages/local" },
    { packageName: "@demo/worker", repositoryPath: "packages/worker" },
  ]);
  expect(first.lockfile.sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(first.dependencyTopologySha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect((await verifyRprToolchainMaterialization(first.root)).ok).toBe(true);
  expect(await readlink(path.join(first.root, "node_modules", "external"))).toMatch(
    /^\.\.\/packages\//u,
  );
  const typescriptApi = first.dependencyLinks.find(
    (entry) => entry.repositoryPath === "packages/local" && entry.packageName === "typescript-api",
  );
  expect(typescriptApi).toBeDefined();

  const lock = JSON.parse(
    await Bun.file(path.join(path.dirname(first.root), "lock.json")).text(),
  ) as {
    entries: Array<{
      id: string;
      packageName?: string;
      dependencies: Array<{ entryId: string; requestedName?: string }>;
    }>;
  };
  const typescriptEntryId = path.basename(typescriptApi!.materializedPath);
  const typescriptEntry = lock.entries.find((entry) => entry.id === typescriptEntryId);
  expect(typescriptEntry?.packageName).toBe("typescript");
  expect(lock.entries.some((entry) => entry.packageName === "typescript-api")).toBe(false);

  const helperEdge = typescriptEntry?.dependencies.find(
    (dependency) => dependency.requestedName === "helper-api",
  );
  expect(helperEdge).toBeDefined();
  expect(lock.entries.find((entry) => entry.id === helperEdge!.entryId)?.packageName).toBe(
    "helper",
  );

  expect(
    await readlink(
      path.join(first.root, typescriptApi!.materializedPath, "node_modules", "helper-api"),
    ),
  ).toMatch(/^\.\.\/\.\.\/dep-/u);
});

test("workspace execution closure preserves importer-scoped incompatible package versions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gr-workspace-conflict-"));
  const rprRoot = await mkdtemp(path.join(tmpdir(), "gr-workspace-conflict-rpr-"));
  roots.add(root);
  roots.add(rprRoot);
  await writeFile(path.join(root, "bun.lock"), '{"lockfileVersion":2}\n');
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "@demo/root",
      workspaces: { packages: ["packages/*"] },
    }),
  );
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const [name, version] of [
    ["one", "1.0.0"],
    ["two", "2.0.0"],
  ] as const) {
    const workspaceRoot = path.join(root, "packages", name);
    await mkdir(path.join(workspaceRoot, "node_modules", "shared"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({
        name: `@demo/${name}`,
        version: "0.1.0",
        dependencies: { shared: version },
      }),
    );
    await writeFile(
      path.join(workspaceRoot, "node_modules", "shared", "package.json"),
      JSON.stringify({ name: "shared", version }),
    );
  }

  const materialized = await ensureWorkspaceExecutionRprMaterialization({
    rprRoot,
    repositoryRoot: root,
  });
  const one = materialized.dependencyLinks.find(
    (entry) => entry.repositoryPath === "packages/one" && entry.packageName === "shared",
  );
  const two = materialized.dependencyLinks.find(
    (entry) => entry.repositoryPath === "packages/two" && entry.packageName === "shared",
  );
  expect(one).toBeDefined();
  expect(two).toBeDefined();
  expect(one!.materializedPath).not.toBe(two!.materializedPath);
  expect(
    JSON.parse(
      await Bun.file(path.join(materialized.root, one!.materializedPath, "package.json")).text(),
    ).version,
  ).toBe("1.0.0");
  expect(
    JSON.parse(
      await Bun.file(path.join(materialized.root, two!.materializedPath, "package.json")).text(),
    ).version,
  ).toBe("2.0.0");
});

test("workspace execution cache invalidates when dependency topology changes without a lockfile change", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gr-workspace-topology-"));
  const rprRoot = await mkdtemp(path.join(tmpdir(), "gr-workspace-topology-rpr-"));
  roots.add(root);
  roots.add(rprRoot);
  await writeFile(path.join(root, "bun.lock"), '{"lockfileVersion":2}\n');
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "@demo/root",
      workspaces: { packages: ["packages/*"] },
      devDependencies: { external: "1.0.0" },
    }),
  );
  const local = path.join(root, "packages", "local");
  await mkdir(path.join(root, "node_modules", "external"), { recursive: true });
  await writeFile(
    path.join(root, "node_modules", "external", "package.json"),
    JSON.stringify({
      name: "external",
      version: "1.0.0",
    }),
  );
  await mkdir(path.join(local, "node_modules", "jsonc-parser"), { recursive: true });
  await writeFile(
    path.join(local, "package.json"),
    JSON.stringify({
      name: "@demo/local",
      version: "0.1.0",
    }),
  );
  await writeFile(
    path.join(local, "node_modules", "jsonc-parser", "package.json"),
    JSON.stringify({
      name: "jsonc-parser",
      version: "3.3.1",
    }),
  );

  const before = await ensureWorkspaceExecutionRprMaterialization({
    rprRoot,
    repositoryRoot: root,
  });
  expect(before.dependencyLinks.some((entry) => entry.packageName === "jsonc-parser")).toBe(false);

  await writeFile(
    path.join(local, "package.json"),
    JSON.stringify({
      name: "@demo/local",
      version: "0.1.0",
      dependencies: { "jsonc-parser": "3.3.1" },
    }),
  );

  const after = await ensureWorkspaceExecutionRprMaterialization({ rprRoot, repositoryRoot: root });
  expect(after.lockfile.sha256).toBe(before.lockfile.sha256);
  expect(after.dependencyTopologySha256).not.toBe(before.dependencyTopologySha256);
  expect(after.root).not.toBe(before.root);
  const runtimePath = path.join(path.dirname(path.dirname(after.root)), "runtime.json");
  const stateBefore = await Bun.file(runtimePath).json();
  await ensureWorkspaceExecutionRprMaterialization({ rprRoot, repositoryRoot: root });
  expect(await Bun.file(runtimePath).json()).toEqual(stateBefore);
  expect(stateBefore.previous).toBe(path.basename(path.dirname(before.root)));
  expect(after.dependencyLinks).toContainEqual(
    expect.objectContaining({
      repositoryPath: "packages/local",
      packageName: "jsonc-parser",
    }),
  );
});

test("GR root producers refuse while GC owns the RPR fence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gr-root-fence-"));
  roots.add(root);
  await withRprStorageLock(root, async () => {
    // Use another async context to model an independent producer, not a nested owner call.
    const code = `import { ensureWorkspaceExecutionRprMaterialization } from ${JSON.stringify(path.resolve(import.meta.dir, "tooling.ts"))}; await ensureWorkspaceExecutionRprMaterialization({rprRoot: ${JSON.stringify(root)}, repositoryRoot: ${JSON.stringify(root)}});`;
    const child = Bun.spawn([process.execPath, "-e", code], { stderr: "pipe", stdout: "pipe" });
    const stderr = await new Response(child.stderr).text();
    expect(await child.exited).not.toBe(0);
    expect(stderr).toContain("RPR_STORAGE_BUSY");
  });
});
