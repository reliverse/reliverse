import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { c, defineConfig } from "../index";
import {
  assertDcsFrozenResolve,
  diffDcsConfigLockfile,
  locateDcsConfigLockfile,
  verifyDcsConfigLockfile,
  writeDcsConfigLockfile,
} from "./index";

const config = defineConfig({
  fileStem: "lock-demo",
  id: "org.reliverse.lock-demo",
  root: c.object({
    token: c
      .secretReference()
      .default({ $secret: { provider: "env", key: "DCS_TOKEN" } })
      .scopes(["workspace"]),
    telemetry: c.boolean().default(false).scopes(["workspace"]),
  }),
});

test("DCS lockfiles freeze resolved config evidence without becoming config layers", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "dcs-lock-"));
  try {
    await writeFile(
      path.join(workspace, "lock-demo.config.jsonc"),
      `{
  // comment intentionally affects documentRevision only
  "telemetry": true,
  "token": { "$secret": { "provider": "env", "key": "DCS_TOKEN" } }
}\n`,
    );

    const lockPath = locateDcsConfigLockfile({ bundle: config.bundle, workspaceRoot: workspace });
    const written = await writeDcsConfigLockfile({
      bundle: config.bundle,
      includeRedactedEffective: true,
      includeUser: false,
      outputPath: lockPath,
      workspaceRoot: workspace,
    });
    expect(written.lockfile.effective.revision).toMatch(/^sha256:/);
    expect(written.lockfile.effective.snapshot?.token).toBe("<redacted>");
    expect(written.lockfile.inputs).toHaveLength(1);
    expect(await readFile(lockPath, "utf8")).toContain('"$dcsLock"');

    const verified = await verifyDcsConfigLockfile({
      bundle: config.bundle,
      includeUser: false,
      lockPath,
      workspaceRoot: workspace,
    });
    expect(verified.ok).toBe(true);

    await writeFile(
      path.join(workspace, "lock-demo.config.jsonc"),
      `{
  // changed comment only
  "telemetry": true,
  "token": { "$secret": { "provider": "env", "key": "DCS_TOKEN" } }
}\n`,
    );
    const commentOnly = await verifyDcsConfigLockfile({
      bundle: config.bundle,
      includeUser: false,
      lockPath,
      workspaceRoot: workspace,
    });
    expect(commentOnly.ok).toBe(false);
    expect(commentOnly.diagnostics.some((diagnostic) => diagnostic.code === "DCS9107")).toBe(true);

    await writeFile(
      path.join(workspace, "lock-demo.config.jsonc"),
      `{
  "telemetry": false,
  "token": { "$secret": { "provider": "env", "key": "DCS_TOKEN" } }
}\n`,
    );
    const changed = await diffDcsConfigLockfile({
      bundle: config.bundle,
      includeUser: false,
      lockPath,
      workspaceRoot: workspace,
    });
    expect(changed.ok).toBe(false);
    expect(changed.diagnostics.some((diagnostic) => diagnostic.code === "DCS9106")).toBe(true);
    expect(changed.differences.some((entry) => entry.path === "/effective/revision")).toBe(true);
    await expect(
      assertDcsFrozenResolve({
        bundle: config.bundle,
        includeUser: false,
        lockPath,
        workspaceRoot: workspace,
      }),
    ).rejects.toThrow("frozen resolve");
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test("profile-specific DCS lockfiles use profile-specific canonical names", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "dcs-lock-profile-"));
  try {
    await writeFile(
      path.join(workspace, "lock-demo.config.production.json"),
      JSON.stringify({ $dcs: { profile: "production" }, telemetry: true }),
    );
    const lockPath = locateDcsConfigLockfile({
      bundle: config.bundle,
      profile: "production",
      workspaceRoot: workspace,
    });
    expect(lockPath.endsWith("lock-demo.config.production.lock.json")).toBe(true);
    const written = await writeDcsConfigLockfile({
      bundle: config.bundle,
      includeUser: false,
      outputPath: lockPath,
      profile: "production",
      workspaceRoot: workspace,
    });
    expect(written.lockfile.$dcsLock.profile).toBe("production");
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});
