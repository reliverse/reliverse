import {
  cleanupGrSnapshotSandbox,
  materializeGrSandboxCleanupReceipt,
  parseGrSnapshotSandbox,
} from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import {
  GR_ARTIFACT_EFFECTS,
  grErrorMessage,
  readGrArtifact,
  resolveGrCliRoot,
  rootOption,
} from "../../../shared";

export default defineCommand({
  meta: {
    name: "cleanup",
    description: "Remove an owned GR snapshot sandbox and materialize its cleanup receipt.",
  },
  conventions: { idempotent: true, supportsApply: true },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.read", "fs.write", "fs.delete", "process.exec"],
  },
  options: { root: rootOption },
  help: {
    examples: [
      "gr sandbox cleanup .private/reliverse/gr/sandboxes/<id>/materialization.json",
      "gr sandbox cleanup materialization.json --apply --json",
    ],
  },
  async handler(ctx) {
    const [sandboxPath] = ctx.cli.positionals;
    if (!sandboxPath || ctx.cli.positionals.length !== 1) {
      ctx.exit(2, "Usage: gr sandbox cleanup <materialization.json> [--root <repository>] --apply");
    }
    try {
      const sandbox = await readGrArtifact(ctx.cwd, sandboxPath!, parseGrSnapshotSandbox);
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const plan = Object.freeze({
        schemaVersion: "gr.sandbox-cleanup-plan.v0",
        operation: "gr.workspace.sandbox.cleanup",
        repositoryRoot: root,
        sandbox: {
          id: sandbox.materializationId,
          fingerprint: sandbox.materializationFingerprint,
          containerRoot: sandbox.containerRoot,
        },
      });
      if (!ctx.safety.apply) {
        if (ctx.output.mode === "json") ctx.output.result(plan, "gr sandbox cleanup preview");
        else {
          ctx.out(`Sandbox cleanup preview: ${sandbox.materializationId}`);
          ctx.out(`Owned path: ${sandbox.containerRoot}`);
          ctx.out("Run with --apply to remove the sandbox and write a cleanup receipt.");
        }
        return;
      }
      ctx.safety.assertApplied(
        "fs.delete",
        "gr sandbox cleanup requires explicit --apply authorization",
      );
      const receipt = await cleanupGrSnapshotSandbox({
        root,
        sandbox,
        grantedEffects: ["filesystem.read", "filesystem.write", "git.read"],
      });
      const artifacts = await materializeGrSandboxCleanupReceipt(
        root,
        sandbox,
        receipt,
        GR_ARTIFACT_EFFECTS,
      );
      const report = Object.freeze({
        schemaVersion: "gr.sandbox-cleanup-command-result.v0",
        receipt,
        artifacts,
      });
      if (ctx.output.mode === "json") ctx.output.result(report, "gr sandbox cleanup");
      else {
        ctx.out(`Cleanup: ${receipt.status}`);
        ctx.out(`Removed path: ${receipt.removedPath}`);
        ctx.out(`Receipt: ${artifacts.manifest}`);
        if (receipt.failure) ctx.out(`${receipt.failure.code}: ${receipt.failure.message}`);
      }
      if (receipt.status === "failed")
        ctx.exit(1, receipt.failure?.message ?? "GR sandbox cleanup failed.");
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
