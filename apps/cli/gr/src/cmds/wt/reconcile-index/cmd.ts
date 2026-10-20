import {
  previewGrWorkTurnIndexReconciliation,
  reconcileGrWorkTurnIndex,
  summarizeGrWorkTurn,
} from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import { grErrorMessage, resolveGrCliRoot, rootOption } from "../../../shared";

export default defineCommand({
  meta: {
    name: "reconcile-index",
    description:
      "Acknowledge an exact external staging event without changing HEAD, index, worktree or baseline.",
  },
  conventions: { idempotent: true, supportsApply: true },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.read", "fs.write", "process.exec"],
  },
  options: {
    root: rootOption,
    indexChangeConfirmed: {
      type: "boolean",
      inputSources: ["flag"],
      description: "Confirm the observed external index change, not an authenticated approval.",
    },
    actor: {
      type: "string",
      inputSources: ["flag"],
      description: "Current WT declared writer; not a Principal.",
    },
    rationale: {
      type: "string",
      inputSources: ["flag"],
      description: "Who changed staging and why it is being acknowledged.",
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
      description: "Exact live snapshot fingerprint from preview.",
    },
  },
  async handler(ctx) {
    let applyOptions;
    if (ctx.safety.apply) {
      const { actor, rationale, workTurnId, turnFingerprint, observedFingerprint } =
        ctx.cli.options;
      if (
        ctx.cli.options.indexChangeConfirmed !== true ||
        !actor ||
        !rationale ||
        !workTurnId ||
        !turnFingerprint ||
        !observedFingerprint
      )
        return ctx.exit(
          2,
          "Use --index-change-confirmed, --actor, --rationale and all three exact preview pins.",
        );
      applyOptions = { actor, rationale, workTurnId, turnFingerprint, observedFingerprint };
    }
    try {
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const grantedEffects = [
        "filesystem.read",
        "git.read",
        "git.write",
        "artifact.write",
      ] as const;
      if (!applyOptions) {
        const p = await previewGrWorkTurnIndexReconciliation({ root, grantedEffects });
        return ctx.output.result(
          {
            operation: "gr.wt.reconcile-index",
            apply: false,
            workTurnId: p.workTurnId,
            turnFingerprint: p.turnFingerprint,
            observedFingerprint: p.observed.snapshotFingerprint,
            previousIndexTree: p.previousIndexTree,
            indexTree: p.observed.indexTree,
            changedIndexPaths: p.changedIndexPaths,
            automaticRetry: false,
          },
          "Index reconciliation preview",
        );
      }
      ctx.safety.assertApplied("fs.write");
      const result = await reconcileGrWorkTurnIndex({
        root,
        grantedEffects,
        indexChangeConfirmed: true,
        ...applyOptions,
      });
      return ctx.output.result(
        {
          turn: summarizeGrWorkTurn(result.turn),
          receiptId: result.receipt.id,
          gitStateChanged: false,
        },
        "Index event acknowledged; original baseline retained",
      );
    } catch (error) {
      return ctx.exit(1, grErrorMessage(error));
    }
  },
});
