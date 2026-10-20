import { defineCommand } from "@reliverse/rempts";

import { rootOption } from "../../../shared";

export default defineCommand({
  meta: {
    name: "push",
    description:
      "Preview a Campaign destination; execution requires the admitted owner-only gr push surface.",
  },
  interactive: "never",
  conventions: { supportsApply: true },
  safety: { defaultMode: "preview", requiresApply: true, effects: ["fs.read"] },
  options: {
    root: rootOption,
    remote: {
      type: "string",
      description: "Preview remote; not execution authority.",
      inputSources: ["flag"],
    },
    ref: {
      type: "string",
      description: "Preview branch; not execution authority.",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    const [planPath] = ctx.cli.positionals;
    if (!planPath)
      return ctx.exit(2, "Usage: gr campaign push <plan.json> [--remote origin] [--ref main]");
    if (ctx.safety.apply)
      return ctx.exit(
        1,
        "GR_CAMPAIGN_GOVERNED_PUSH_REQUIRED: --apply cannot self-grant Git publication. Use the exact admitted gr push owner-terminal binding.",
      );
    return ctx.output.result(
      {
        operation: "gr.campaign.push",
        planPath,
        remote: ctx.cli.options.remote ?? "origin",
        ref: ctx.cli.options.ref ?? "main",
        preview: true,
        executionSurface: "gr push",
        automaticRetry: false,
      },
      "GR campaign push preview",
    );
  },
});
