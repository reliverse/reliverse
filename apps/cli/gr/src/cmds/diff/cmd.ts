import { createGrPatch, diffGrSnapshots, parseGrSnapshot } from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import { formatChangedFiles, grErrorMessage, readGrArtifact } from "../../shared";

export default defineCommand({
  meta: {
    name: "diff",
    description: "Compare two exact GR snapshots with bounded semantic output.",
  },
  conventions: { idempotent: true, supportsApply: false },
  safety: { defaultMode: "execute", requiresApply: false, effects: ["fs.read", "process.exec"] },
  options: {
    all: {
      type: "boolean",
      description: "Show every changed path instead of the first 20.",
      inputSources: ["flag"],
    },
    patch: {
      type: "boolean",
      description:
        "Emit the raw forward repository patch; JSON mode returns the typed patch object.",
      inputSources: ["flag"],
    },
  },
  help: {
    examples: [
      "gr diff .private/reliverse/gr/snapshots/<before>/snapshot.json .private/reliverse/gr/snapshots/<result>/snapshot.json",
      "gr diff before.json result.json --patch",
      "gr diff before.json result.json --json",
    ],
  },
  async handler(ctx) {
    const [beforePath, resultPath] = ctx.cli.positionals;
    if (!beforePath || !resultPath || ctx.cli.positionals.length !== 2) {
      ctx.exit(2, "Usage: gr diff <before-snapshot.json> <result-snapshot.json> [--all|--patch]");
    }
    try {
      const [before, result] = await Promise.all([
        readGrArtifact(ctx.cwd, beforePath!, parseGrSnapshot),
        readGrArtifact(ctx.cwd, resultPath!, parseGrSnapshot),
      ]);
      if (ctx.cli.options.patch === true) {
        const patch = await createGrPatch(before, result, { grantedEffects: ["git.read"] });
        if (ctx.output.mode === "json") ctx.output.result(patch, "gr diff patch");
        else ctx.out(patch.forward.content.trimEnd());
        return;
      }
      const diff = await diffGrSnapshots(before, result, { grantedEffects: ["git.read"] });
      if (ctx.output.mode === "json") {
        ctx.output.result(diff, "gr diff");
        return;
      }
      ctx.out(`Before: ${diff.before.id}`);
      ctx.out(`Result: ${diff.result.id}`);
      ctx.out(`Changed paths: ${diff.files.length}`);
      for (const line of formatChangedFiles(
        diff.files,
        ctx.cli.options.all === true ? undefined : 20,
      )) {
        ctx.out(line);
      }
      ctx.out(`Diff: ${diff.diffFingerprint}`);
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
