import path from "node:path";

import { defineCommand } from "@reliverse/rempts";
import { verifyRprToolchainMaterialization } from "@reliverse/rpr-toolchain-materialization";

export default defineCommand({
  meta: {
    name: "verify-tooling",
    description: "Verify one relocatable RPR toolchain materialization.",
  },
  interactive: "never",
  async handler(ctx) {
    const input = ctx.cli.positionals[0];
    if (!input) return ctx.exit(2, "Usage: gr bundle verify-tooling <materialization-root>");
    const root = path.resolve(ctx.cwd, input);
    const result = await verifyRprToolchainMaterialization(root);
    if (!result.ok) return ctx.exit(1, `RPR_TOOLCHAIN_INVALID:${result.diagnostics.join(",")}`);
    return ctx.output.result({ root, ...result }, "RPR toolchain materialization verified");
  },
});
