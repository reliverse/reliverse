import { defineCommand } from "@reliverse/rempts";

import { explainCommand } from "../../../impl/core/explain";
import {
  formatExplainOutput,
  handleRelpackError,
  isJsonOutput,
  normalizeArgs,
  printJson,
} from "../_shared";

const COMMAND_NAME = "explain";

export default defineCommand({
  meta: {
    name: COMMAND_NAME,
    description: "Explain what a relpack command would do without executing it.",
  },
  conventions: {
    idempotent: true,
    supportsApply: false,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: false,
    effects: [],
  },
  help: {
    examples: [
      "rse relpack explain pack ./dist -o dist.tar.zst",
      "rse relpack explain pack ./dist -o dist.tar.zst --overwrite",
      "rse relpack explain unpack dist.zip -o ./out --overwrite",
      "rse relpack explain list dist.zip",
    ],
    text: "Explain a relpack subcommand using the same arguments you would pass to that subcommand.",
  },
  options: {},
  async handler(ctx) {
    try {
      const explanation = explainCommand(normalizeArgs(ctx.args));

      if (isJsonOutput(ctx)) {
        printJson(ctx, { ok: true, command: COMMAND_NAME, explanation });
        return;
      }

      ctx.out?.(formatExplainOutput(explanation.summary, explanation.notes));
    } catch (error) {
      handleRelpackError(ctx, COMMAND_NAME, error);
    }
  },
});
