import {
  previewGrWorkTurnRecovery,
  recoverInterruptedGrWorkTurn,
  summarizeGrWorkTurn,
} from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import { grErrorMessage, resolveGrCliRoot, rootOption } from "../../../shared";

export default defineCommand({
  meta: {
    name: "recover",
    description: "Inspect and retire interrupted WT evidence without changing Git state.",
  },
  conventions: { idempotent: true, supportsApply: true },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.read", "fs.write", "process.exec"],
  },
  options: {
    root: rootOption,
    writerStopped: {
      type: "boolean",
      default: false,
      inputSources: ["flag"],
      description: "Explicitly confirm the previous cooperative writer has stopped.",
    },
    actor: {
      type: "string",
      inputSources: ["flag"],
      description: "Declared recovering actor, not authenticated Principal.",
    },
    rationale: {
      type: "string",
      inputSources: ["flag"],
      description: "Why interrupted evidence must be retired.",
    },
    workTurnId: {
      type: "string",
      inputSources: ["flag"],
      description: "Exact WT ID from preview.",
    },
    turnFingerprint: {
      type: "string",
      inputSources: ["flag"],
      description: "Exact WT fingerprint from preview.",
    },
    observedFingerprint: {
      type: "string",
      inputSources: ["flag"],
      description: "Exact observed snapshot fingerprint from preview.",
    },
  },
  async handler(ctx) {
    try {
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const grantedEffects = [
        "filesystem.read",
        "git.read",
        "git.write",
        "artifact.write",
      ] as const;
      if (!ctx.safety.apply) {
        const preview = await previewGrWorkTurnRecovery({ root, grantedEffects });
        const result = {
          operation: "gr.wt.recover",
          root,
          apply: false,
          workTurnId: preview.workTurnId,
          turnFingerprint: preview.turnFingerprint,
          observedFingerprint: preview.observed.snapshotFingerprint,
          observedSnapshotId: preview.observed.snapshotId,
          head: preview.observed.head,
          indexTree: preview.observed.indexTree,
          worktreeTree: preview.observed.worktreeTree,
        };
        if (ctx.output.mode === "json")
          ctx.output.result(result, "Interrupted WT recovery preview");
        else ctx.out(JSON.stringify(result, null, 2));
        return;
      }
      const { actor, rationale, workTurnId, turnFingerprint, observedFingerprint } =
        ctx.cli.options;
      if (
        ctx.cli.options.writerStopped !== true ||
        !actor ||
        !rationale ||
        !workTurnId ||
        !turnFingerprint ||
        !observedFingerprint
      )
        ctx.exit(
          2,
          "Recovery requires --writer-stopped, --actor, --rationale and all three exact preview pins.",
        );
      ctx.safety.assertApplied("fs.write");
      const turn = await recoverInterruptedGrWorkTurn({
        root,
        actor,
        rationale,
        workTurnId,
        turnFingerprint,
        observedFingerprint,
        writerStopped: true,
        grantedEffects,
      });
      const result = summarizeGrWorkTurn(turn);
      if (ctx.output.mode === "json")
        ctx.output.result(result, "Interrupted WT retired; no patch or Git mutation");
      else
        ctx.out(
          `Work Turn: ${turn.id} (${turn.state}); baseline/history retained, no patch invented.`,
        );
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
