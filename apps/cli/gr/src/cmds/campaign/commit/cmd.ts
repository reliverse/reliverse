import { defineCommand } from "@reliverse/rempts";

export default defineCommand({
  meta: {
    name: "commit",
    description: "Preview a Campaign step; execution requires an admitted commit binding.",
  },
  interactive: "never",
  conventions: { supportsApply: true },
  safety: { defaultMode: "preview", requiresApply: true, effects: ["fs.read"] },
  options: {
    id: {
      type: "string",
      description: "Commit spec ID from the campaign plan.",
      inputSources: ["flag"],
    },
    root: {
      type: "string",
      description: "Preview repository root; not authority.",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    const [planPath, ...extra] = ctx.cli.positionals;
    const id = ctx.cli.options.id;
    if (!planPath || !id || extra.length)
      return ctx.exit(2, "Usage: gr campaign commit <plan.json> --id <commit-id>");
    if (ctx.safety.apply)
      return ctx.exit(
        1,
        "GR_CAMPAIGN_GOVERNED_COMMIT_REQUIRED: --apply cannot self-grant commit authority. Use an exact admitted gr commit binding.",
      );
    return ctx.output.result(
      {
        operation: "gr.campaign.commit",
        planPath,
        commitId: id,
        preview: true,
        executionSurface: "gr commit",
        automaticRetry: false,
      },
      "GR campaign commit preview",
    );
  },
});
