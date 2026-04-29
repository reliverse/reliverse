import { defineCommand, type CommandTreeReport } from "@reliverse/rempts";
import { getRemptsTargetOptions, runTargetRemptsCommand } from "../../../../lib/target-cli";

export default defineCommand({
  meta: {
    name: "tree",
    description: "Show the merged command tree visible to the current CLI session.",
  },
  help: {
    examples: ["rse rempts commands tree", "rse rempts commands tree --json"],
  },
  async handler(ctx) {
    const targetOptions = getRemptsTargetOptions(ctx.options);
    const report = targetOptions.cli
      ? (await runTargetRemptsCommand<CommandTreeReport>({
          commandPath: ["rempts", "commands", "tree"],
          cwd: ctx.cwd,
          rawTargetOptions: ctx.options,
        })).data
      : ctx.cli?.commandTree ?? ctx.exit(1, "Command-tree diagnostics are unavailable in this CLI session.");

    if (ctx.output.mode === "json") {
      ctx.output.result(report, "rempts commands tree");
      return;
    }

    for (const node of report.nodes) {
      const label = node.path.length > 0 ? node.path.join(" ") : "<root>";
      const chosen = node.chosenCommand ? `${node.chosenCommand.sourceId}/${node.chosenCommand.sourceKind}` : "(container only)";
      ctx.out(`${label} -> ${chosen}`);
      if (node.availableSubcommands.length > 0) {
        ctx.out(`  subcommands: ${node.availableSubcommands.join(", ")}`);
      }
    }
  },
});
