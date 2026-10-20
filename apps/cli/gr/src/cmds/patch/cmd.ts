import { createGrPatch, materializeGrPatch, parseGrSnapshot } from "@reliverse/gr";
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
    name: "patch",
    description:
      "Create and materialize forward and reverse portable repository patches for two snapshots.",
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
      "gr patch <before-snapshot.json> <result-snapshot.json> --apply",
      "gr patch before.json result.json --root /work/repo --apply --json",
    ],
  },
  async handler(ctx) {
    const [beforePath, resultPath] = ctx.cli.positionals;
    if (!beforePath || !resultPath || ctx.cli.positionals.length !== 2) {
      ctx.exit(
        2,
        "Usage: gr patch <before-snapshot.json> <result-snapshot.json> [--root <repository>] --apply",
      );
    }
    try {
      const [before, result] = await Promise.all([
        readGrArtifact(ctx.cwd, beforePath!, parseGrSnapshot),
        readGrArtifact(ctx.cwd, resultPath!, parseGrSnapshot),
      ]);
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const plan = Object.freeze({
        schemaVersion: "gr.patch-plan.v0",
        operation: "gr.patch.create",
        repositoryRoot: root,
        before: snapshotReference(before),
        result: snapshotReference(result),
      });
      if (!ctx.safety.apply) {
        if (ctx.output.mode === "json") ctx.output.result(plan, "gr patch preview");
        else {
          ctx.out(`Patch preview: ${before.snapshotId} -> ${result.snapshotId}`);
          ctx.out(`Repository: ${root}`);
          ctx.out("Run with --apply to create and materialize forward and reverse patches.");
        }
        return;
      }
      ctx.safety.assertApplied("fs.write", "gr patch requires explicit --apply authorization");
      const patch = await createGrPatch(before, result, { grantedEffects: ["git.read"] });
      const artifacts = await materializeGrPatch(root, patch, GR_ARTIFACT_EFFECTS);
      const report = Object.freeze({
        schemaVersion: "gr.patch-command-result.v0",
        patch,
        artifacts,
      });
      if (ctx.output.mode === "json") ctx.output.result(report, "gr patch");
      else {
        ctx.out(`Patch: ${patch.patchId}`);
        ctx.out(`Changed paths: ${patch.diff.files.length}`);
        ctx.out(`Forward: ${artifacts.files.changesPatch}`);
        ctx.out(`Reverse: ${artifacts.files.reversePatch}`);
        ctx.out(`Manifest: ${artifacts.manifest}`);
      }
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
