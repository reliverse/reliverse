import path from "node:path";

import { verifyGrBundleSetArtifact, verifyGrRepositoryBundleArtifact } from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import { grErrorMessage } from "../../../shared";

export default defineCommand({
  meta: {
    name: "verify",
    description: "Verify one GR repository bundle and its available tooling attachments.",
  },
  interactive: "never",
  async handler(ctx) {
    const selected = ctx.cli.positionals[0];
    if (!selected || ctx.cli.positionals.length !== 1)
      return ctx.exit(2, "Usage: gr bundle verify <bundle.tar.zst>");

    const archive = path.resolve(ctx.cwd, selected);

    let bundleSet: Awaited<ReturnType<typeof verifyGrBundleSetArtifact>>;
    try {
      bundleSet = await verifyGrBundleSetArtifact({ archive });
    } catch (error) {
      return ctx.exit(1, grErrorMessage(error));
    }

    if (bundleSet.recognized) {
      if (!bundleSet.ok) return ctx.exit(1, bundleSet.diagnostics.join(", "));
      return ctx.output.result(bundleSet, "GR Global Handoff bundle verification");
    }

    let result: Awaited<ReturnType<typeof verifyGrRepositoryBundleArtifact>>;
    try {
      result = await verifyGrRepositoryBundleArtifact({ archive });
    } catch (error) {
      return ctx.exit(1, grErrorMessage(error));
    }

    if (!result.ok) return ctx.exit(1, result.diagnostics.join(", "));
    return ctx.output.result(result, "GR repository bundle verification");
  },
});
