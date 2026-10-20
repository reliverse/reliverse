import { inspectGrRepositoryVersion, prepareGrTransition } from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import { grErrorMessage, resolveGrCliRoot, rootOption } from "../../shared";

export default defineCommand({
  meta: {
    name: "version",
    description: "Inspect repository release metadata and the next private GR transition.",
  },
  conventions: { idempotent: true, supportsApply: false },
  safety: { defaultMode: "execute", requiresApply: false, effects: ["fs.read", "process.exec"] },
  options: { root: rootOption },
  help: {
    examples: ["gr version", "gr version --root /work/repo --json"],
  },
  async handler(ctx) {
    if (ctx.cli.positionals.length !== 0) ctx.exit(2, "Usage: gr version [--root <repository>]");
    try {
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const current = await inspectGrRepositoryVersion(root, {
        grantedEffects: ["filesystem.read", "git.read"],
      });
      const prepared = await prepareGrTransition(root, current, {
        grantedEffects: ["filesystem.read"],
      });
      const result = Object.freeze({
        schemaVersion: "gr.repository-version-inspection.v0",
        operation: "gr.repository.version.inspect",
        repositoryRoot: root,
        current,
        nextTransition: prepared.transition,
        nextPatchArtifact: `${current.artifactName}-${prepared.transition.transitionId}.patch`,
      });
      if (ctx.output.mode === "json") ctx.output.result(result, "gr version");
      else {
        ctx.out(`Repository: ${current.artifactName}`);
        ctx.out(`Release metadata version: ${current.version}`);
        ctx.out(`Next private GR transition: ${prepared.transition.transitionId}`);
        ctx.out(`Next patch artifact: ${result.nextPatchArtifact}`);
      }
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
