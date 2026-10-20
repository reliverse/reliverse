import { installGrGitAuthorityHooks } from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import { grErrorMessage, resolveGrCliRoot, rootOption } from "../../../shared";

export default defineCommand({
  meta: {
    name: "install",
    description: "Install GR-owned Git mutation guard hooks as defense in depth.",
  },
  conventions: { idempotent: true, supportsApply: true },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.read", "fs.write", "process.exec"],
  },
  options: { root: rootOption },
  help: { examples: ["gr hooks install", "gr hooks install --apply"] },
  async handler(ctx) {
    try {
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      if (!ctx.safety.apply) {
        const plan = {
          schemaVersion: "gr.hooks-install-plan.v0",
          operation: "gr.hooks.install",
          root,
          authority: "GR",
          directGitMutation: "denied-when-hookable",
        } as const;
        if (ctx.output.mode === "json") ctx.output.result(plan, "gr hooks install preview");
        else {
          ctx.out(`GR Hooks preview: ${root}`);
          ctx.out(
            "Guards commit/ref/push/rebase/merge hook surfaces. Agent-policy classification also covers git add and other index/worktree mutations.",
          );
          ctx.out("Run with --apply to install.");
        }
        return;
      }
      ctx.safety.assertApplied("fs.write", "gr hooks install requires --apply");
      const receipt = await installGrGitAuthorityHooks({
        root,
        grantedEffects: ["filesystem.read", "filesystem.write", "git.read", "git.write"],
      });
      if (ctx.output.mode === "json") ctx.output.result(receipt, "gr hooks install");
      else {
        ctx.out(`GR Hooks: installed`);
        ctx.out(`Path: ${receipt.hooksPath}`);
        ctx.out(`Hooks: ${receipt.hooks.join(", ")}`);
      }
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
