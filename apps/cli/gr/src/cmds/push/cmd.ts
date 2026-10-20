import { defineCommand } from "@reliverse/rempts";

import { dispatchGrOwnerPush } from "../../owner-push";
import { resolveGrCliRoot, rootOption } from "../../shared";

export default defineCommand({
  meta: {
    name: "push",
    description:
      "Preview or owner-launch one exact admitted Campaign push; never ordinary git push.",
  },
  interactive: "tty",
  conventions: { supportsApply: true, idempotent: false },
  safety: { defaultMode: "preview", requiresApply: true, effects: ["fs.read", "network.publish"] },
  options: { root: rootOption },
  async handler(ctx) {
    if (ctx.cli.positionals.length)
      return ctx.exit(
        2,
        "gr push accepts no plan, remote or ref arguments; those belong to the admitted host binding.",
      );
    if (ctx.safety.apply) ctx.safety.assertApplied("network.publish");
    const result = await dispatchGrOwnerPush({
      root: await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root),
      apply: ctx.safety.apply,
      interactive: ctx.interaction.canPrompt,
    });
    ctx.output.result(result, ctx.safety.apply ? "GR owner push" : "GR owner push preview");
  },
});
