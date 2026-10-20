import path from "node:path";

import { restoreGrBundleContinuation } from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import { grErrorMessage, resolveGrCliRoot, rootOption } from "../../../shared";

const EFFECTS = ["filesystem.read", "filesystem.write", "git.read"] as const;

export default defineCommand({
  meta: {
    name: "restore-continuation",
    description:
      "Restore checksum-bound private GR continuation state from an extracted repository bundle through RVS Private topology.",
  },
  conventions: { idempotent: true, supportsApply: true },
  safety: { defaultMode: "preview", requiresApply: true, effects: ["fs.read", "fs.write"] },
  options: {
    root: rootOption,
    privateRoot: {
      type: "string",
      description: "Optional explicit RVS Private root override for continuation materialization.",
      inputSources: ["flag"],
    },
  },
  help: {
    examples: [
      "gr bundle restore-continuation ./extracted-bundle --root ./restored-repo",
      "gr bundle restore-continuation ./extracted-bundle --root ./restored-repo --private-root /srv/private/repo --apply --json",
    ],
  },
  async handler(ctx) {
    try {
      const bundleRootArg = ctx.cli.positionals[0];
      if (!bundleRootArg)
        return ctx.exit(
          2,
          "Usage: gr bundle restore-continuation <extracted-bundle-root> [--root <repository>] [--private-root <path>] [--apply]",
        );
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const bundleRoot = path.resolve(ctx.cwd, bundleRootArg);
      const privateRoot = ctx.cli.options.privateRoot
        ? path.resolve(ctx.cwd, ctx.cli.options.privateRoot)
        : undefined;
      if (!ctx.safety.apply) {
        const plan = Object.freeze({
          schemaVersion: "gr.private-continuation-restore-plan.v0",
          operation: "gr.repository.bundle.continuation.restore",
          root,
          bundleRoot,
          privateRoot: privateRoot ?? null,
          applyRequired: true,
        });
        if (ctx.output.mode === "json")
          ctx.output.result(plan, "gr bundle restore-continuation preview");
        else {
          ctx.out(`Repository: ${root}`);
          ctx.out(`Bundle root: ${bundleRoot}`);
          ctx.out(`RVS Private root: ${privateRoot ?? "resolved from RVS Private topology"}`);
          ctx.out("Run with --apply to verify and restore private GR continuation state.");
        }
        return;
      }
      ctx.safety.assertApplied("fs.write", "gr bundle restore-continuation requires --apply");
      const result = await restoreGrBundleContinuation({
        root,
        bundleRoot,
        ...(privateRoot ? { topology: { privateRoot } } : {}),
        grantedEffects: EFFECTS,
      });
      if (ctx.output.mode === "json") ctx.output.result(result, "gr bundle restore-continuation");
      else {
        ctx.out(`Continuation restored: ${result.restored ? "yes" : "no"}`);
        ctx.out(`Reason: ${result.reason}`);
        if ("statePath" in result) ctx.out(`State: ${result.statePath}`);
      }
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
