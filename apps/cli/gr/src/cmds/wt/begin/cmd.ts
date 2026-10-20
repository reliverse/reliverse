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
  meta: { name: "begin", description: "Begin repository Work Turn evidence." },
  conventions: { idempotent: false, supportsApply: true },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.read", "fs.write", "process.exec"],
  },
  options: {
    root: rootOption,
    id: {
      type: "string",
      description: "Unique work turn ID, for example stage030-wt2.",
      inputSources: ["flag"],
    },
    actor: {
      type: "string",
      description: "Declared actor label; not an authentication proof.",
      inputSources: ["flag"],
    },
    baseline: {
      type: "string",
      description: "Explicit existing live baseline for bootstrap adoption.",
      inputSources: ["flag"],
    },
    acceptedHead: {
      type: "boolean",
      default: false,
      description: "Explicitly use clean-index accepted HEAD after superseding stale evidence.",
      inputSources: ["flag"],
    },
    handoff: {
      type: "string",
      description: "Optional Global Handoff repository root (global=true).",
      inputSources: ["flag"],
    },
    stage: {
      type: "string",
      description: "Stable Handoff stage ID; defaults to its active stage.",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    try {
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      if (!ctx.cli.options.id) ctx.exit(2, "gr wt begin requires --id.");
      if (!ctx.safety.apply) {
        if (ctx.output.mode === "json")
          ctx.output.result({ operation: "gr.wt.begin", root, apply: false }, "Work Turn preview");
        else
          ctx.out(
            "Work Turn begin preview. Use --apply to persist evidence; source versions and Git history are not advanced.",
          );
        return;
      }
      ctx.safety.assertApplied("fs.write");
      const effects = ["filesystem.read", "git.read", "git.write", "artifact.write"] as const;
      const turn = await beginGrWorkTurn({
        root,
        id: ctx.cli.options.id!,
        actor: ctx.cli.options.actor ?? "declared-agent",
        scope: ctx.cli.positionals,
        grantedEffects: effects,
        acceptedHead: ctx.cli.options.acceptedHead === true,
        ...(ctx.cli.options.baseline
          ? { baseline: await readGrArtifact(ctx.cwd, ctx.cli.options.baseline, parseGrSnapshot) }
          : {}),
        ...(ctx.cli.options.handoff
          ? { handoffRoot: path.resolve(ctx.cwd, ctx.cli.options.handoff) }
          : {}),
        ...(ctx.cli.options.stage ? { stageId: ctx.cli.options.stage } : {}),
      });
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
