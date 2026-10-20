import { supersedeGrWorkTurn, summarizeGrWorkTurn } from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import { grErrorMessage, resolveGrCliRoot, rootOption } from "../../../shared";

export default defineCommand({
  meta: {
    name: "supersede",
    description: "Close stale Work Turn evidence at an accepted descendant HEAD.",
  },
  conventions: { idempotent: true, supportsApply: true },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.read", "fs.write", "process.exec"],
  },
  options: {
    root: rootOption,
    acceptedHead: {
      type: "boolean",
      default: false,
      description: "Confirm that current descendant HEAD is the accepted recovery baseline.",
      inputSources: ["flag"],
    },
    rationale: {
      type: "string",
      description: "Required audit rationale for superseding stale evidence.",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    try {
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      if (ctx.cli.options.acceptedHead !== true)
        ctx.exit(2, "gr wt supersede requires --accepted-head.");
      if (!ctx.cli.options.rationale) ctx.exit(2, "gr wt supersede requires --rationale.");
      if (!ctx.safety.apply) {
        const preview = { operation: "gr.wt.supersede", root, apply: false };
        if (ctx.output.mode === "json")
          ctx.output.result(preview, "Work Turn supersession preview");
        else ctx.out("Work Turn supersession preview. Use --apply after verifying accepted HEAD.");
        return;
      }
      ctx.safety.assertApplied("fs.write");
      const turn = await supersedeGrWorkTurn({
        root,
        acceptedHead: true,
        rationale: ctx.cli.options.rationale,
        grantedEffects: ["filesystem.read", "git.read", "git.write", "artifact.write"],
      });
      const summary = summarizeGrWorkTurn(turn);
      if (ctx.output.mode === "json") ctx.output.result(summary, "GR Work Turn");
      else {
        ctx.out(ctx.colors.stdout.yellow(`Work Turn: ${turn.id} (${turn.state})`));
        ctx.out(`Accepted baseline: ${turn.supersession?.acceptedBaseline.snapshotId}`);
        ctx.out(`Rationale: ${turn.supersession?.rationale}`);
      }
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
