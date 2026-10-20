import { defineCommand } from "@reliverse/rempts";

export default defineCommand({
  meta: {
    name: "hooks",
    description:
      "Install and inspect GR authority policy projections, including Git-hook defense in depth.",
  },
  conventions: { idempotent: true, supportsApply: false },
  safety: { defaultMode: "execute", requiresApply: false, effects: [] },
  async handler(ctx) {
    if (ctx.cli.positionals.length === 0) {
      ctx.out("Use a hooks subcommand, for example: gr hooks status");
      return;
    }
    ctx.exit(2, "Usage: gr hooks <subcommand>");
  },
});
