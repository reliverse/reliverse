import { defineCommand } from "@reliverse/rempts";

export default defineCommand({
  meta: {
    name: "campaign",
    description:
      "Plan and govern bounded GR source-release campaigns against an explicit public Git base.",
  },
  conventions: { idempotent: true, supportsApply: false },
  safety: { defaultMode: "execute", requiresApply: false, effects: [] },
  async handler(ctx) {
    if (ctx.cli.positionals.length === 0) {
      ctx.out("Use a campaign subcommand, for example: gr campaign plan --help");
      return;
    }
    ctx.exit(2, "Usage: gr campaign <subcommand>");
  },
});
