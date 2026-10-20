import {
  createGrAcceptedRevisionSnapshot,
  createGrSnapshot,
  inspectGrWorkspace,
  materializeGrSnapshot,
  type GrSnapshot,
} from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import {
  GR_ARTIFACT_EFFECTS,
  GR_READ_EFFECTS,
  GR_SNAPSHOT_EFFECTS,
  grErrorMessage,
  resolveGrCliRoot,
  rootOption,
  snapshotReference,
} from "../../shared";

const roles = ["baseline", "checkpoint", "explicit", "result"] as const;

export default defineCommand({
  meta: { name: "snapshot", description: "Create and materialize an immutable typed GR snapshot." },
  conventions: { idempotent: true, supportsApply: true },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.read", "fs.write", "process.exec"],
  },
  options: {
    root: rootOption,
    role: {
      type: "string",
      choices: roles,
      defaultValue: "explicit",
      description: "Semantic role recorded in the snapshot.",
      inputSources: ["flag"],
    },
    acceptedHead: {
      type: "boolean",
      description:
        "Capture the accepted HEAD revision while ignoring current staged/unstaged/untracked work.",
      inputSources: ["flag"],
    },
    captureDirty: {
      type: "boolean",
      description: "Explicitly capture a dirty baseline; dirty workspaces are rejected by default.",
      inputSources: ["flag"],
    },
  },
  help: {
    examples: [
      "gr snapshot --role baseline --apply",
      "gr snapshot packages/gr-core apps/cli/gr --role checkpoint --apply",
      "gr snapshot --capture-dirty --role result --apply",
      "gr snapshot --accepted-head --role baseline --apply",
    ],
  },
  async handler(ctx) {
    try {
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const role = (ctx.cli.options.role ?? "explicit") as GrSnapshot["role"];
      const scope =
        ctx.cli.positionals.length === 0
          ? ({ kind: "workspace" } as const)
          : ({ kind: "paths", paths: ctx.cli.positionals } as const);
      const inspection = await inspectGrWorkspace(root, { grantedEffects: GR_READ_EFFECTS });
      if (ctx.cli.options.acceptedHead === true && scope.kind !== "workspace")
        ctx.exit(2, "--accepted-head is whole-workspace only; narrow paths when bundling.");
      const plan = Object.freeze({
        schemaVersion: "gr.snapshot-plan.v0",
        operation: "gr.workspace.snapshot",
        repository: inspection.repository,
        role,
        scope,
        dirtyPolicy:
          ctx.cli.options.acceptedHead === true
            ? "accepted-head"
            : ctx.cli.options.captureDirty === true
              ? "capture"
              : "reject",
        current: inspection.summary,
      });
      if (!ctx.safety.apply) {
        if (ctx.output.mode === "json") ctx.output.result(plan, "gr snapshot preview");
        else {
          ctx.out(`Snapshot preview: ${role}`);
          ctx.out(`Repository: ${root}`);
          ctx.out(`Scope: ${scope.kind === "workspace" ? "workspace" : scope.paths.join(", ")}`);
          ctx.out(`Dirty policy: ${plan.dirtyPolicy}`);
          ctx.out("Run with --apply to create Git objects and materialize the snapshot.");
        }
        return;
      }
      ctx.safety.assertApplied("fs.write", "gr snapshot requires explicit --apply authorization");
      const snapshot =
        ctx.cli.options.acceptedHead === true
          ? await createGrAcceptedRevisionSnapshot({
              root,
              role,
              scope,
              grantedEffects: GR_READ_EFFECTS,
            })
          : await createGrSnapshot({
              root,
              role,
              scope,
              dirtyPolicy: plan.dirtyPolicy as "capture" | "reject",
              grantedEffects: GR_SNAPSHOT_EFFECTS,
            });
      const artifacts = await materializeGrSnapshot(root, snapshot, GR_ARTIFACT_EFFECTS);
      const report = Object.freeze({
        schemaVersion: "gr.snapshot-command-result.v0",
        snapshot,
        artifacts,
      });
      if (ctx.output.mode === "json") ctx.output.result(report, "gr snapshot");
      else {
        ctx.out(`Snapshot: ${snapshot.snapshotId}`);
        ctx.out(`Role: ${snapshot.role}`);
        ctx.out(`Worktree tree: ${snapshot.worktreeTree.oid}`);
        ctx.out(`Retention: ${snapshot.retention}`);
        ctx.out(`Artifact: ${artifacts.manifest}`);
        ctx.out(`Fingerprint: ${snapshotReference(snapshot).fingerprint}`);
      }
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
