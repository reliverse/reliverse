import {
  captureGrSnapshotSandboxResult,
  materializeGrSnapshot,
  parseGrSnapshot,
  parseGrSnapshotSandbox,
} from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import {
  GR_ARTIFACT_EFFECTS,
  GR_MUTATION_EFFECTS,
  grErrorMessage,
  readGrArtifact,
  resolveGrCliRoot,
  rootOption,
  snapshotReference,
} from "../../../shared";

export default defineCommand({
  meta: {
    name: "capture",
    description: "Capture a sandbox result snapshot under an exact changed-path allowlist.",
  },
  conventions: { idempotent: true, supportsApply: true },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.read", "fs.write", "process.exec"],
  },
  options: { root: rootOption },
  help: {
    examples: [
      "gr sandbox capture baseline.json materialization.json src/index.ts --apply",
      "gr sandbox capture baseline.json materialization.json package.json bun.lock --apply --json",
    ],
  },
  async handler(ctx) {
    const [baselinePath, sandboxPath, ...allowedChangedPaths] = ctx.cli.positionals;
    if (!baselinePath || !sandboxPath) {
      ctx.exit(
        2,
        "Usage: gr sandbox capture <baseline-snapshot.json> <materialization.json> [allowed-path ...] [--root <repository>] --apply",
      );
    }
    try {
      const [baseline, sandbox] = await Promise.all([
        readGrArtifact(ctx.cwd, baselinePath!, parseGrSnapshot),
        readGrArtifact(ctx.cwd, sandboxPath!, parseGrSnapshotSandbox),
      ]);
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const plan = Object.freeze({
        schemaVersion: "gr.sandbox-capture-plan.v0",
        operation: "gr.workspace.sandbox.capture",
        repositoryRoot: root,
        baseline: snapshotReference(baseline),
        sandbox: {
          id: sandbox.materializationId,
          fingerprint: sandbox.materializationFingerprint,
          workspaceRoot: sandbox.workspaceRoot,
        },
        allowedChangedPaths,
      });
      if (!ctx.safety.apply) {
        if (ctx.output.mode === "json") ctx.output.result(plan, "gr sandbox capture preview");
        else {
          ctx.out(`Sandbox capture preview: ${sandbox.materializationId}`);
          ctx.out(
            `Allowed changed paths: ${allowedChangedPaths.length === 0 ? "none" : allowedChangedPaths.join(", ")}`,
          );
          ctx.out("Run with --apply to capture and validate the exact result tree.");
        }
        return;
      }
      ctx.safety.assertApplied(
        "fs.write",
        "gr sandbox capture requires explicit --apply authorization",
      );
      const snapshot = await captureGrSnapshotSandboxResult({
        root,
        baseline,
        sandbox,
        allowedChangedPaths,
        grantedEffects: GR_MUTATION_EFFECTS,
      });
      const artifacts = await materializeGrSnapshot(root, snapshot, GR_ARTIFACT_EFFECTS);
      const report = Object.freeze({
        schemaVersion: "gr.sandbox-capture-command-result.v0",
        snapshot,
        artifacts,
      });
      if (ctx.output.mode === "json") ctx.output.result(report, "gr sandbox capture");
      else {
        ctx.out(`Result snapshot: ${snapshot.snapshotId}`);
        ctx.out(`Worktree tree: ${snapshot.worktreeTree.oid}`);
        ctx.out(`Allowed paths: ${allowedChangedPaths.length}`);
        ctx.out(`Artifact: ${artifacts.manifest}`);
      }
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
