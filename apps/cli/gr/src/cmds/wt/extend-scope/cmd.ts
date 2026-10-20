import { extendGrWorkTurnScope, previewGrWorkTurnScopeExtension } from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import { grErrorMessage, resolveGrCliRoot, rootOption } from "../../../shared";

const effects = [
  "filesystem.read",
  "filesystem.write",
  "git.read",
  "git.write",
  "artifact.write",
] as const;

export default defineCommand({
  meta: {
    name: "extend-scope",
    description: "Extend an active Work Turn only to exact changed paths with an audit rationale.",
  },
  conventions: { idempotent: true, supportsApply: true },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.read", "fs.write", "process.exec"],
  },
  options: {
    root: rootOption,
    rationale: {
      type: "string",
      description: "Required rationale for including the exact changed paths in this Work Turn.",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    try {
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const rationale = ctx.cli.options.rationale;
      const paths = ctx.cli.positionals;
      if (!rationale?.trim()) ctx.exit(2, "gr wt extend-scope requires --rationale.");
      if (paths.length === 0)
        ctx.exit(2, "gr wt extend-scope requires one or more exact changed paths.");
      if (!ctx.safety.apply) {
        const plan = await previewGrWorkTurnScopeExtension({
          root,
          paths,
          rationale,
          grantedEffects: ["filesystem.read", "git.read"],
        });
        const preview = { operation: "gr.wt.extend-scope", apply: false, ...plan };
        if (ctx.output.mode === "json")
          ctx.output.result(preview, "Work Turn scope extension preview");
        else {
          ctx.out(`Work Turn: ${plan.workTurnId}`);
          ctx.out(`Current scope: ${plan.currentScope.join(", ") || "workspace (unbounded)"}`);
          ctx.out(`Adding exact changed paths: ${plan.addedPaths.join(", ")}`);
          ctx.out(`Observed snapshot: ${plan.observedSnapshotId}`);
          ctx.out(`Rationale: ${plan.rationale}`);
          ctx.out("Use --apply to persist this append-only scope extension.");
        }
        return;
      }
      ctx.safety.assertApplied("fs.write");
      const result = await extendGrWorkTurnScope({
        root,
        paths,
        rationale,
        grantedEffects: effects,
      });
      const output = {
        operation: "gr.wt.extend-scope",
        workTurnId: result.turn.id,
        state: result.turn.state,
        scope: result.turn.scope,
        extension: result.extension,
      };
      if (ctx.output.mode === "json") ctx.output.result(output, "Work Turn scope extension");
      else {
        ctx.out(`Work Turn: ${result.turn.id} (${result.turn.state})`);
        ctx.out(`Added: ${result.extension.addedPaths.join(", ")}`);
        ctx.out(`Observed snapshot: ${result.extension.observedSnapshotId}`);
        ctx.out(`Rationale: ${result.extension.rationale}`);
      }
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
