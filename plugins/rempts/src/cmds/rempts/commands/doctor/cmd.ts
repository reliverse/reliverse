import {
  defineCommand,
  type CommandTreeReport,
  type PluginDiscoveryLoadedPlugin,
  type PluginDiscoveryReport,
} from "@reliverse/rempts";
import { getRemptsTargetOptions, runTargetRemptsCommand } from "../../../../lib/target-cli";

type PluginMetaForDoctor = Pick<PluginDiscoveryLoadedPlugin, "pluginName" | "priorityMatch">;

export default defineCommand({
  meta: {
    name: "doctor",
    description: "Show command-level precedence and collision diagnostics.",
  },
  help: {
    examples: ["rse rempts commands doctor", "rse rempts commands doctor --json"],
    text: "Useful for understanding why one command source wins over another and how nested trees merge.",
  },
  async handler(ctx) {
    const targetOptions = getRemptsTargetOptions(ctx.options);
    const report = targetOptions.cli
      ? (await runTargetRemptsCommand<CommandTreeReport>({
          commandPath: ["rempts", "commands", "doctor"],
          cwd: ctx.cwd,
          rawTargetOptions: ctx.options,
        })).data
      : ctx.cli?.commandTree ?? ctx.exit(1, "Command-tree diagnostics are unavailable in this CLI session.");
    const pluginDiscovery = targetOptions.cli
      ? (await runTargetRemptsCommand<PluginDiscoveryReport>({
          commandPath: ["rempts", "plugins", "doctor"],
          cwd: ctx.cwd,
          rawTargetOptions: ctx.options,
        })).data
      : ctx.cli?.pluginDiscovery;

    const pluginMetaByName = new Map(
      (pluginDiscovery?.loaded ?? []).map((plugin: PluginMetaForDoctor) => [plugin.pluginName, plugin] as const),
    );

    if (ctx.output.mode === "json") {
      ctx.output.result(report, "rempts commands doctor");
      return;
    }

    for (const node of report.nodes) {
      const label = node.path.length > 0 ? node.path.join(" ") : "<root>";
      const chosen = node.chosenCommand ? `${node.chosenCommand.sourceId} (${node.chosenCommand.sourceKind})` : "(no command node)";
      ctx.out(`${label}: ${chosen}`);
      if (node.shadowedCommands.length > 0) {
        ctx.out(`  shadowed: ${node.shadowedCommands.map((entry) => `${entry.sourceId} (${entry.sourceKind})`).join(", ")}`);
        if (node.chosenCommand?.sourceKind === "plugin") {
          const chosenPlugin = pluginMetaByName.get(node.chosenCommand.sourceId);
          const chosenReason = chosenPlugin?.priorityMatch
            ? `${chosenPlugin.priorityMatch.kind}:${chosenPlugin.priorityMatch.rule}@${chosenPlugin.priorityMatch.index}`
            : "default loaded-plugin order";
          ctx.out(`  precedence: exact-node winner selected by ${chosenReason}`);
        }
      }
      const mergedSubcommands = node.subcommandDiagnostics.filter((entry) => entry.sources.length > 1);
      if (mergedSubcommands.length > 0) {
        ctx.out(`  merged subcommands:`);
        for (const entry of mergedSubcommands) {
          ctx.out(`  - ${entry.name}: ${entry.sources.join(", ")}`);
        }
      }
    }
  },
});
