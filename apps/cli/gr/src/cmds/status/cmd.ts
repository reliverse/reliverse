import { inspectGrWorkspace } from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import {
  formatWorkspaceStatus,
  GR_READ_EFFECTS,
  grErrorMessage,
  resolveGrCliRoot,
  rootOption,
} from "../../shared";

export default defineCommand({
  meta: {
    name: "status",
    aliases: ["inspect"],
    description: "Inspect normalized Git workspace state without changing the worktree or index.",
  },
  conventions: { idempotent: true, supportsApply: false },
  safety: { defaultMode: "execute", requiresApply: false, effects: ["fs.read", "process.exec"] },
  options: {
    root: rootOption,
    all: {
      type: "boolean",
      description: "Show every changed path instead of the bounded important-path sample.",
      inputSources: ["flag"],
    },
  },
  help: { examples: ["gr status", "gr status --all", "gr status --json"] },
  async handler(ctx) {
    try {
      if (ctx.cli.positionals.length > 0)
        ctx.exit(2, "Usage: gr status [--root <repository>] [--all]");
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const inspection = await inspectGrWorkspace(root, { grantedEffects: GR_READ_EFFECTS });
      if (ctx.output.mode === "json") {
        ctx.output.result(inspection, "gr status");
        return;
      }
      const head = inspection.head.ref ?? inspection.head.commit?.oid ?? inspection.head.state;
      ctx.out(`Repository: ${inspection.repository.root}`);
      ctx.out(`HEAD: ${inspection.head.state} (${head})`);
      ctx.out(`Workspace: ${inspection.summary.dirty ? "dirty" : "clean"}`);
      ctx.out(
        `Changes: ${inspection.summary.staged} staged, ${inspection.summary.unstaged} unstaged, ${inspection.summary.untracked} untracked, ${inspection.summary.conflicted} conflicted`,
      );
      for (const line of formatWorkspaceStatus(
        inspection.entries,
        ctx.cli.options.all === true ? undefined : 20,
      )) {
        ctx.out(line);
      }
      ctx.out(`Inspection: ${inspection.inspectionFingerprint}`);
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
