import {
  createGrPatch,
  createGrRecoveryCapsule,
  materializeGrRecoveryCapsule,
  parseGrSnapshot,
} from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import {
  GR_ARTIFACT_EFFECTS,
  grErrorMessage,
  readGrArtifact,
  resolveGrCliRoot,
  rootOption,
  snapshotReference,
} from "../../shared";

export default defineCommand({
  meta: {
    name: "recovery",
    description: "Create and materialize a patch-only recovery capsule for two snapshots.",
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
      "gr recovery <before-snapshot.json> <result-snapshot.json> --apply",
      "gr recovery before.json result.json --root /work/repo --apply --json",
    ],
  },
  async handler(ctx) {
    const [beforePath, resultPath] = ctx.cli.positionals;
    if (!beforePath || !resultPath || ctx.cli.positionals.length !== 2) {
      ctx.exit(
        2,
        "Usage: gr recovery <before-snapshot.json> <result-snapshot.json> [--root <repository>] --apply",
      );
    }
    try {
      const [before, result] = await Promise.all([
        readGrArtifact(ctx.cwd, beforePath!, parseGrSnapshot),
        readGrArtifact(ctx.cwd, resultPath!, parseGrSnapshot),
      ]);
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const plan = Object.freeze({
        schemaVersion: "gr.recovery-plan.v0",
        operation: "gr.recovery.create",
        profile: "patch-only",
        repositoryRoot: root,
        before: snapshotReference(before),
        result: snapshotReference(result),
      });
      if (!ctx.safety.apply) {
        if (ctx.output.mode === "json") ctx.output.result(plan, "gr recovery preview");
        else {
          ctx.out(`Recovery preview: ${before.snapshotId} -> ${result.snapshotId}`);
          ctx.out("Profile: patch-only");
          ctx.out("Run with --apply to create and materialize the capsule.");
        }
        return;
      }
      ctx.safety.assertApplied("fs.write", "gr recovery requires explicit --apply authorization");
      const patch = await createGrPatch(before, result, { grantedEffects: ["git.read"] });
      const capsule = createGrRecoveryCapsule(patch);
      const artifacts = await materializeGrRecoveryCapsule(root, capsule, GR_ARTIFACT_EFFECTS);
      const report = Object.freeze({
        schemaVersion: "gr.recovery-command-result.v0",
        capsule,
        artifacts,
      });
      if (ctx.output.mode === "json") ctx.output.result(report, "gr recovery");
      else {
        ctx.out(`Recovery capsule: ${capsule.capsuleId}`);
        ctx.out(`Profile: ${capsule.profile}`);
        ctx.out(`Changed paths: ${capsule.patch.diff.files.length}`);
        ctx.out(`Artifact: ${artifacts.manifest}`);
        for (const limitation of capsule.limitations) ctx.out(`Limitation: ${limitation}`);
      }
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
