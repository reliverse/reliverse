import { inspectGrGitAuthorityHooks } from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import { grErrorMessage, resolveGrCliRoot, rootOption } from "../../../shared";

export default defineCommand({
  meta: {
    name: "status",
    description: "Inspect whether GR Git authority guard hooks are installed.",
  },
  conventions: { idempotent: true, supportsApply: false },
  safety: { defaultMode: "execute", requiresApply: false, effects: ["fs.read", "process.exec"] },
  options: { root: rootOption },
  async handler(ctx) {
    try {
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const result = await inspectGrGitAuthorityHooks(root);
      if (ctx.output.mode === "json") ctx.output.result(result, "gr hooks status");
      else {
        ctx.out(`GR Hooks: ${result.configured ? "configured" : "not configured"}`);
        if (result.hooksPath) ctx.out(`Path: ${result.hooksPath}`);
        if (result.missing.length) ctx.out(`Missing: ${result.missing.join(", ")}`);
      }
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
