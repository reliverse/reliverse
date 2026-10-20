import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { buildDlerRemptsHostArtifacts } from "@reliverse/dler-build";
import { updateRprCommonToolchain } from "@reliverse/rpr-cli/common-toolchain-update";
import {
  executeRprExecutableAdmission,
  planRprExecutableAdmission,
} from "@reliverse/rpr-cli/executable-admission";
import {
  createRprNativeLock,
  createRprToolchainComposition,
  readRprNativeLock,
} from "@reliverse/rpr-cli/native-lock";
import { withRprStorageLock } from "@reliverse/rpr-cli/storage-lock";
import { readStoredRprRelease, updateStoredRprReleaseStatus } from "@reliverse/rpr-cli/store";

const hostRoot = path.resolve(import.meta.dir, "..");
const storeRoot = path.resolve(homedir(), ".reliverse/rpr");
const base = path.join(storeRoot, "toolchains/common");
const outputDirectory = path.join(hostRoot, "dist/common-update");
const initial = JSON.parse(await readFile(path.join(base, "composition.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(hostRoot, "package.json"), "utf8"));
const artifact = await buildDlerRemptsHostArtifacts({
  application: "gr",
  owner: "reliverse",
  hostRoot,
  allowedPluginPatterns: [],
  pluginPackageNames: [],
  externalPlugins: "disabled",
  features: {
    config: false,
    doctor: false,
    frameworkDiagnostics: false,
    plugins: false,
    prompts: false,
    setup: false,
    toolBridge: false,
    tui: false,
  },
  runnerFile: path.join(hostRoot, "src/cli.ts"),
  runnerExport: "runGrArtifact",
  outputDirectory,
  smokeArgs: ["--version"],
});
const receiptPath = path.join(outputDirectory, "gr.build-receipt.json");
const result = await withRprStorageLock(storeRoot, async () => {
  const oldLock = await readRprNativeLock(path.join(base, "lock.json"));
  const oldComposition = JSON.parse(await readFile(path.join(base, "composition.json"), "utf8"));
  if (oldComposition.compositionId !== initial.compositionId)
    throw new Error("GR_COMMON_BUILD_BASELINE_CHANGED");
  const old = oldLock.entries.find((entry) => entry.id === "gr");
  if (!old || old.projection !== "gr") throw new Error("GR_COMMON_PROJECTION_REQUIRED");
  const plan = await planRprExecutableAdmission({
    receiptPath,
    recordId: old.recordId,
    version: `${manifest.version}-dev.${artifact.executable.artifact.digest.slice(7, 23)}`,
    executableName: "gr",
    payloadRetention: "development",
  });
  const admitted = await executeRprExecutableAdmission({ receiptPath, storeRoot, plan });
  const release = await updateStoredRprReleaseStatus(storeRoot, admitted.releaseId, "active");
  const tree = release.blobs.find((blob) => blob.role === "source-tree")?.digest;
  if (!tree?.startsWith("sha256:")) throw new Error("GR_COMMON_ADMISSION_TREE_REQUIRED");
  const lock = createRprNativeLock({
    target: oldLock.target,
    roots: oldLock.roots,
    entries: oldLock.entries.map((entry) =>
      entry.id !== "gr"
        ? entry
        : {
            ...entry,
            releaseId: release.releaseId,
            recordId: release.recordId,
            version: release.version,
            treeDigest: tree as `sha256:${string}`,
            executable: "bin/gr",
          },
    ),
  });
  const composition = createRprToolchainComposition({
    name: oldComposition.name,
    lock,
    entries: oldComposition.entries,
    ...(oldComposition.rootEntries ? { rootEntries: oldComposition.rootEntries } : {}),
    profile: oldComposition.profile,
  });
  const update = await updateRprCommonToolchain({
    storeRoot,
    lock,
    composition,
    expectedCompositionId: initial.compositionId,
    healthCheck: async (root) => {
      const child = Bun.spawn([path.join(root, "bin/gr"), "--version"], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 10_000,
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code !== 0) throw new Error(`GR_COMMON_HEALTH_FAILED:${stderr || stdout}`);
    },
  });
  const persisted = await readStoredRprRelease(storeRoot, release.releaseId);
  return {
    ...update,
    releaseId: persisted.releaseId,
    executableDigest: artifact.executable.artifact.digest,
    sourceRevision: artifact.buildOptions.sourceRevision,
    buildReceipt: receiptPath,
    projection: path.join(homedir(), ".reliverse/bin/gr"),
    materializationRoot: path.join(base, "materialized"),
  };
});
await writeFile(
  path.join(outputDirectory, "common-update-receipt.json"),
  JSON.stringify(result, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(result, null, 2));
