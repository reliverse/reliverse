import { defineCommand } from "@reliverse/rempts";

import { dispatchGrOwnerCommit } from "../../owner-push";
import { resolveGrCliRoot, rootOption } from "../../shared";
export default defineCommand({
  meta: {
    name: "commit",
    description:
      "Preview or execute one exact admitted repository commit binding; no ambient staging or self-granted authority.",
  },
  interactive: "tty",
  conventions: { supportsApply: true, idempotent: false },
  safety: { defaultMode: "preview", requiresApply: true, effects: ["fs.read", "git.commit"] },
  options: { root: rootOption },
  async handler(ctx) {
    if (ctx.cli.positionals.length)
      return ctx.exit(
        2,
        "gr commit accepts no arbitrary plan/path arguments; selection belongs to the admitted host binding.",
      );
    if (ctx.safety.apply) ctx.safety.assertApplied("git.commit");
    const result = await dispatchGrOwnerCommit({
      root: await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root),
      apply: ctx.safety.apply,
      interactive: ctx.interaction.canPrompt,
    });
    ctx.output.result(result, ctx.safety.apply ? "GR owner commit" : "GR owner commit preview");
  },
});
