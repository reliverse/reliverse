import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import {
  createConfigContractBundle,
  type ConfigContractBundle,
  type DcsMigrationPlan,
} from "@reliverse/dcs-contract";

import {
  applyDcsConfigMigration,
  planDcsConfigMigration,
  restoreDcsConfigMigration,
} from "./migration";

const migration: DcsMigrationPlan = {
  $dcs: {
    format: "dcs-migration-plan",
    from: { contractVersion: 1, documentVersion: 1 },
    id: "org.example.demo-tool",
    to: { contractVersion: 2, documentVersion: 1 },
    version: "0.0.1",
  },
  operations: [{ from: "/server", op: "rename", to: "/network" }],
};

const sourceBundle = makeBundle(1, "server");
const targetBundle = makeBundle(2, "network", [migration]);

function common(directory: string) {
  return {
    bundle: targetBundle,
    format: "jsonc" as const,
    homeDir: path.join(directory, "home"),
    includeLocal: false,
    includeUser: false,
    includeWorkspace: true,
    mode: "adopt-new-defaults" as const,
    scope: "workspace" as const,
    sourceBundle,
    workspaceRoot: directory,
  };
}

test("plan/apply/restore keep JSONC comments and provide a reversible receipt", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dcs-migration-"));
  try {
    const location = path.join(directory, "demo-tool.config.jsonc");
    const before = `{
  // envelope stays readable
  "$dcs": { "id": "org.example.demo-tool", "contractVersion": 1, "documentVersion": 1 },
  // server is becoming network
  "server": { "host": "10.0.0.1", "port": 3100 },
  // untouched comment
  "$extensions": { "org.example.keep": { "enabled": true } },
}
`;
    await writeFile(location, before, "utf8");
    const preview = await planDcsConfigMigration(common(directory));
    expect(preview.document.network).toEqual({ host: "10.0.0.1", port: 3100 });
    expect(preview.document.server).toBeUndefined();

    const receiptPath = path.join(directory, "migration.receipt.json");
    const applied = await applyDcsConfigMigration({ ...common(directory), receiptPath });
    const after = await readFile(location, "utf8");
    expect(after).toContain("// untouched comment");
    expect(after).toContain('"network"');
    expect(after).not.toContain('"server"');
    expect(applied.receipt.before.text).toBe(before);

    const restored = await restoreDcsConfigMigration({
      currentBundle: targetBundle,
      receiptPath,
      sourceBundle,
    });
    expect(restored.result.documentRevision).toBe(applied.receipt.before.documentRevision);
    expect(await readFile(location, "utf8")).toBe(before);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("preserve-effective materializes a changed inherited default under the target path", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dcs-migration-defaults-"));
  try {
    await writeFile(
      path.join(directory, "demo-tool.config.jsonc"),
      `{
  "$dcs": { "id": "org.example.demo-tool", "contractVersion": 1, "documentVersion": 1 }
}
`,
      "utf8",
    );
    const preview = await planDcsConfigMigration({
      ...common(directory),
      mode: "preserve-effective",
    });
    expect(preview.document.network).toEqual({ host: "127.0.0.1", port: 3000 });
    expect(preview.materializedPaths).toEqual(["/network"]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

function makeBundle(
  version: number,
  root: "server" | "network",
  migrations?: readonly DcsMigrationPlan[],
): ConfigContractBundle {
  return createConfigContractBundle({
    $dcs: {
      contractVersion: version,
      documentVersion: 1,
      fileStem: "demo-tool",
      id: "org.example.demo-tool",
      specVersion: "0.0.1",
    },
    defaults: { [root]: { host: version === 1 ? "127.0.0.1" : "0.0.0.0", port: 3000 } },
    fields: {
      [`/${root}`]: {
        merge: "deep",
        resettable: true,
        scopes: ["user", "workspace", "local", "invocation"],
        secret: false,
      },
      [`/${root}/host`]: {
        merge: "replace",
        resettable: true,
        scopes: ["user", "workspace", "local", "invocation"],
        secret: false,
      },
      [`/${root}/port`]: {
        merge: "replace",
        resettable: true,
        scopes: ["user", "workspace", "local", "invocation"],
        secret: false,
      },
    },
    ...(migrations === undefined ? {} : { migrations }),
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      additionalProperties: false,
      properties: {
        [root]: {
          additionalProperties: false,
          properties: { host: { type: "string" }, port: { type: "number" } },
          required: ["host", "port"],
          type: "object",
        },
      },
      required: [root],
      type: "object",
    },
  });
}
