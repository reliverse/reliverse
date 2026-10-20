import path from "node:path";

import { readGrRepositoryBundleReceipt } from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import { grErrorMessage } from "../../../shared";

export default defineCommand({
  meta: { name: "inspect", description: "Inspect one GR repository bundle receipt." },
  interactive: "never",
  async handler(ctx) {
    try {
      const selected = ctx.cli.positionals[0];
      if (!selected || ctx.cli.positionals.length !== 1)
        return ctx.exit(2, "Usage: gr bundle inspect <bundle-or-receipt>");
      const resolved = path.resolve(ctx.cwd, selected);
      const receiptPath = resolved.endsWith(".receipt.json")
        ? resolved
        : `${resolved}.receipt.json`;
      ctx.output.result(
        await readGrRepositoryBundleReceipt(receiptPath),
        "GR repository bundle receipt",
      );
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
