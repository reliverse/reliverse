import {
  finalizeGrVersionedPatch,
  inspectGrRepositoryVersion,
  prepareGrTransition,
  parseGrSnapshot,
} from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import {
  grErrorMessage,
  readGrArtifact,
  resolveGrCliRoot,
  rootOption,
  snapshotReference,
} from "../../../shared";

const FINALIZE_EFFECTS = [
  "artifact.write",
  "filesystem.read",
  "filesystem.write",
  "git.read",
  "git.write",
] as const;

export default defineCommand({
  meta: {
    name: "finalize",
    description:
      "Finalize repository changes as the next version-named portable patch from an exact baseline.",
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
      "gr patch finalize .private/reliverse/gr/snapshots/<baseline>/snapshot.json",
      "gr patch finalize baseline.json --root /work/repo --apply --json",
    ],
  },
  async handler(ctx) {
    const [beforePath] = ctx.cli.positionals;
    if (!beforePath || ctx.cli.positionals.length !== 1) {
      ctx.exit(
        2,
        "Usage: gr patch finalize <baseline-snapshot.json> [--root <repository>] --apply",
      );
    }
    try {
      const before = await readGrArtifact(ctx.cwd, beforePath!, parseGrSnapshot);
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const baselineVersion = await inspectGrRepositoryVersion(root, {
        snapshot: before,
        grantedEffects: ["filesystem.read", "git.read"],
      });
      const prepared = await prepareGrTransition(root, baselineVersion, {
        grantedEffects: ["filesystem.read"],
      });
      const plan = Object.freeze({
        schemaVersion: "gr.versioned-patch-plan.v0",
        operation: "gr.patch.finalize",
        repositoryRoot: root,
        baseline: snapshotReference(before),
        packageName: baselineVersion.packageName,
        artifactName: baselineVersion.artifactName,
        repositoryVersion: baselineVersion.version,
        nextTransition: prepared.transition,
      });
      if (!ctx.safety.apply) {
        if (ctx.output.mode === "json") ctx.output.result(plan, "gr patch finalize preview");
        else {
          ctx.out(`Repository patch preview: ${baselineVersion.artifactName}`);
          ctx.out(`Release metadata version: ${baselineVersion.version}`);
          ctx.out(`Next private GR transition: ${prepared.transition.transitionId}`);
          ctx.out("GR will leave package.json unchanged and materialize a transition-named patch.");
          ctx.out(
            "Run with --apply to capture the result and advance private GR transition state.",
          );
        }
        return;
      }
      ctx.safety.assertApplied(
        "fs.write",
        "gr patch finalize requires explicit --apply authorization",
      );
      const result = await finalizeGrVersionedPatch(root, before, {
        grantedEffects: FINALIZE_EFFECTS,
      });
      if (ctx.output.mode === "json") ctx.output.result(result, "gr patch finalize");
      else {
        ctx.out(
          `Private GR transition: ${result.transition.transitionId} (repository version ${result.transition.repository.version})`,
        );
        ctx.out(`Patch: ${result.artifacts.files.changesPatch}`);
        ctx.out(`Reverse: ${result.artifacts.files.reversePatch}`);
        ctx.out(`Manifest: ${result.artifacts.manifest}`);
      }
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
