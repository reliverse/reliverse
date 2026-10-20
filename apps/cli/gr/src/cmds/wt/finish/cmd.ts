import path from "node:path";

import {
  beginGrWorkTurn,
  inspectGrWorkTurn,
  finishGrWorkTurn,
  summarizeGrWorkTurn,
  parseGrSnapshot,
} from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import { resolveGrCliRoot, rootOption, grErrorMessage, readGrArtifact } from "../../../shared";
export default defineCommand({
  meta: { name: "finish", description: "Finish repository Work Turn evidence." },
  conventions: { idempotent: true, supportsApply: true },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.read", "fs.write", "process.exec"],
  },
  options: { root: rootOption },
  async handler(ctx) {
    try {
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);

      if (!ctx.safety.apply) {
        if (ctx.output.mode === "json")
          ctx.output.result({ operation: "gr.wt.finish", root, apply: false }, "Work Turn preview");
        else
          ctx.out(
            "Work Turn finish preview. Use --apply to persist evidence; source versions and Git history are not advanced.",
          );
        return;
      }
      ctx.safety.assertApplied("fs.write");
      const effects = ["filesystem.read", "git.read", "git.write", "artifact.write"] as const;
      const turn = await finishGrWorkTurn({ root, grantedEffects: effects });
      const summary = summarizeGrWorkTurn(turn);
      if (ctx.output.mode === "json") ctx.output.result(summary, "GR Work Turn");
      else {
        ctx.out(ctx.colors.stdout.cyan(`Work Turn: ${turn?.id ?? "none"} (${summary.state})`));
        if (turn?.handoff) ctx.out(`Stage: ${turn.handoff.stageOrder} / ${turn.handoff.stageId}`);
        if (turn) ctx.out(`Baseline: ${turn.baseline.snapshotId}`);
        if (turn?.artifacts) {
          ctx.out(`Changed paths: ${turn.artifacts.changedPaths}`);
          ctx.out(`Forward: ${turn.artifacts.forward}`);
          ctx.out(`Reverse: ${turn.artifacts.reverse}`);
          ctx.out(`Manifest: ${turn.artifacts.manifest}`);
        }
      }
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
