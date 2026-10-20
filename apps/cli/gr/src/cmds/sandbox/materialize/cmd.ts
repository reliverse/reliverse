import {
  cleanupGrSnapshotSandbox,
  materializeGrSnapshotSandbox,
  materializeGrSnapshotSandboxArtifact,
  parseGrSnapshot,
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
    name: "materialize",
    description: "Materialize an exact snapshot tree in a GR-owned ephemeral sandbox.",
  },
  conventions: { idempotent: false, supportsApply: true },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.read", "fs.write", "process.exec"],
  },
  options: { root: rootOption },
  help: {
    examples: [
      "gr sandbox materialize .private/reliverse/gr/snapshots/<id>/snapshot.json --apply",
      "gr sandbox materialize baseline.json --root /work/repo --apply --json",
    ],
  },
  async handler(ctx) {
    const [baselinePath] = ctx.cli.positionals;
    if (!baselinePath || ctx.cli.positionals.length !== 1) {
      ctx.exit(
        2,
        "Usage: gr sandbox materialize <baseline-snapshot.json> [--root <repository>] --apply",
      );
    }
    try {
      const baseline = await readGrArtifact(ctx.cwd, baselinePath!, parseGrSnapshot);
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const plan = Object.freeze({
        schemaVersion: "gr.sandbox-materialize-plan.v0",
        operation: "gr.workspace.sandbox.materialize",
        repositoryRoot: root,
        baseline: snapshotReference(baseline),
        retention: "ephemeral",
      });
      if (!ctx.safety.apply) {
        if (ctx.output.mode === "json") ctx.output.result(plan, "gr sandbox materialize preview");
        else {
          ctx.out(`Sandbox preview for: ${baseline.snapshotId}`);
          ctx.out(`Repository: ${root}`);
          ctx.out("Retention: ephemeral");
          ctx.out("Run with --apply to create the owned temporary workspace.");
        }
        return;
      }
      ctx.safety.assertApplied(
        "fs.write",
        "gr sandbox materialize requires explicit --apply authorization",
      );
      const sandbox = await materializeGrSnapshotSandbox({
        root,
        baseline,
        grantedEffects: GR_MUTATION_EFFECTS,
      });
      let artifacts;
      try {
        artifacts = await materializeGrSnapshotSandboxArtifact(root, sandbox, GR_ARTIFACT_EFFECTS);
      } catch (error) {
        await cleanupGrSnapshotSandbox({
          root,
          sandbox,
          grantedEffects: ["filesystem.read", "filesystem.write", "git.read"],
        });
        throw error;
      }
      const report = Object.freeze({
        schemaVersion: "gr.sandbox-materialize-command-result.v0",
        sandbox,
        artifacts,
      });
      if (ctx.output.mode === "json") ctx.output.result(report, "gr sandbox materialize");
      else {
        ctx.out(`Sandbox: ${sandbox.materializationId}`);
        ctx.out(`Workspace: ${sandbox.workspaceRoot}`);
        ctx.out(`Baseline: ${sandbox.baseline.id}`);
        ctx.out(`Manifest: ${artifacts.manifest}`);
        ctx.out("Retention: ephemeral; run gr sandbox cleanup when finished.");
      }
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
