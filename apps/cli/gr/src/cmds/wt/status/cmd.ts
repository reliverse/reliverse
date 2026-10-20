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
  meta: { name: "status", description: "Status repository Work Turn evidence." },
  conventions: { idempotent: true, supportsApply: false },
  safety: { defaultMode: "execute", requiresApply: false, effects: ["fs.read", "process.exec"] },
  options: { root: rootOption },
  async handler(ctx) {
    try {
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);

      const effects = ["filesystem.read", "git.read"] as const;
      const turn = await inspectGrWorkTurn({ root, grantedEffects: effects });
      const summary = summarizeGrWorkTurn(turn);
      if (ctx.output.mode === "json") ctx.output.result(summary, "GR Work Turn");
      else {
        ctx.out(ctx.colors.stdout.cyan(`Work Turn: ${turn?.id ?? "none"} (${summary.state})`));
        if (turn?.handoff) ctx.out(`Stage: ${turn.handoff.stageOrder} / ${turn.handoff.stageId}`);
        if (turn) ctx.out(`Baseline: ${turn.baseline.snapshotId}`);
        if (turn)
          ctx.out(
            `Scope: ${turn.scope.length === 0 ? "workspace (all public paths)" : turn.scope.join(", ")}`,
          );
        for (const extension of turn?.scopeExtensions ?? []) {
          ctx.out(`Scope extension ${extension.id}: ${extension.addedPaths.join(", ")}`);
          ctx.out(`Rationale: ${extension.rationale}`);
          ctx.out(`Observed snapshot: ${extension.observedSnapshotId}`);
        }
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
