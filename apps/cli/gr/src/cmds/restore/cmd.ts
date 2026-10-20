import {
  materializeGrRestoreReceipt,
  parseGrRecoveryCapsule,
  restoreGrRecoveryCapsule,
} from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import {
  GR_ARTIFACT_EFFECTS,
  GR_MUTATION_EFFECTS,
  grErrorMessage,
  readGrArtifact,
  resolveGrCliRoot,
  rootOption,
} from "../../shared";

export default defineCommand({
  meta: {
    name: "restore",
    description:
      "Apply a recovery capsule after exact repository, HEAD, index, and tree preflight.",
  },
  conventions: { idempotent: true, supportsApply: true },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.read", "fs.write", "process.exec"],
  },
  options: {
    root: rootOption,
    direction: {
      type: "string",
      choices: ["forward", "reverse"],
      defaultValue: "reverse",
      description:
        "Apply the forward transition or restore the before snapshot with the reverse patch.",
      inputSources: ["flag"],
    },
  },
  help: {
    examples: [
      "gr restore .private/reliverse/gr/recovery/<capsule-id>/capsule.json --direction reverse",
      "gr restore capsule.json --direction reverse --apply",
      "gr restore capsule.json --direction forward --root /work/repo --apply --json",
    ],
  },
  async handler(ctx) {
    const [capsulePath] = ctx.cli.positionals;
    if (!capsulePath || ctx.cli.positionals.length !== 1) {
      ctx.exit(
        2,
        "Usage: gr restore <capsule.json> [--direction forward|reverse] [--root <repository>] --apply",
      );
    }
    try {
      const capsule = await readGrArtifact(ctx.cwd, capsulePath!, parseGrRecoveryCapsule);
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const direction = (ctx.cli.options.direction ?? "reverse") as "forward" | "reverse";
      const plan = Object.freeze({
        schemaVersion: "gr.restore-plan.v0",
        operation: "gr.restore",
        repositoryRoot: root,
        capsule: { id: capsule.capsuleId, fingerprint: capsule.capsuleFingerprint },
        direction,
        expectedSnapshot:
          direction === "forward"
            ? capsule.patch.before.snapshotId
            : capsule.patch.result.snapshotId,
        desiredSnapshot:
          direction === "forward"
            ? capsule.patch.result.snapshotId
            : capsule.patch.before.snapshotId,
      });
      if (!ctx.safety.apply) {
        if (ctx.output.mode === "json") ctx.output.result(plan, "gr restore preview");
        else {
          ctx.out(`Restore preview: ${capsule.capsuleId}`);
          ctx.out(`Direction: ${direction}`);
          ctx.out(`Expected state: ${plan.expectedSnapshot}`);
          ctx.out(`Desired state: ${plan.desiredSnapshot}`);
          ctx.out("Run with --apply to perform exact preflight and mutation.");
        }
        return;
      }
      ctx.safety.assertApplied("fs.write", "gr restore requires explicit --apply authorization");
      const runId = ctx.artifacts?.runId;
      if (!runId)
        throw new Error("gr restore requires the Rempts artifact context for receipt identity.");
      const receipt = await restoreGrRecoveryCapsule({
        root,
        capsule,
        direction,
        authorization: { kind: "cli-flag", source: `gr restore --direction ${direction} --apply` },
        grantedEffects: GR_MUTATION_EFFECTS,
        runId,
        createdAt: new Date().toISOString(),
      });
      const artifacts = await materializeGrRestoreReceipt(root, receipt, GR_ARTIFACT_EFFECTS);
      const report = Object.freeze({
        schemaVersion: "gr.restore-command-result.v0",
        receipt,
        artifacts,
      });
      if (ctx.output.mode === "json") ctx.output.result(report, "gr restore");
      else {
        ctx.out(`Restore: ${receipt.status}`);
        ctx.out(`Preflight: ${receipt.preflight.status}`);
        ctx.out(`Direction: ${receipt.direction}`);
        ctx.out(
          `Restored paths: ${receipt.files.filter((file) => file.status === "restored").length}`,
        );
        ctx.out(`Receipt: ${artifacts.manifest}`);
        if (receipt.failure) ctx.out(`${receipt.failure.code}: ${receipt.failure.message}`);
      }
      if (receipt.status !== "succeeded")
        ctx.exit(1, receipt.failure?.message ?? "GR restore failed.");
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
