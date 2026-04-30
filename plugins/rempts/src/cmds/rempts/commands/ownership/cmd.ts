import {
  defineCommand,
  type CommandTreeReport,
  type PluginDiscoveryLoadedPlugin,
  type PluginDiscoveryReport,
} from "@reliverse/rempts";

import { getRemptsTargetOptions, runTargetRemptsCommand } from "../../../../lib/target-cli";

function buildPluginMap(
  report: PluginDiscoveryReport | undefined,
): Map<string, PluginDiscoveryLoadedPlugin> {
  return new Map((report?.loaded ?? []).map((plugin) => [plugin.pluginName, plugin] as const));
}

export default defineCommand({
  meta: {
    name: "ownership",
    description: "Show provenance and ownership for each merged command node.",
  },
  help: {
    examples: [
      "rse rempts commands ownership",
      "rse rempts commands ownership --cli @reliverse/rse --json",
    ],
    text: "Useful when you want a fast ownership/provenance view without the extra narrative of explain.",
  },
  async handler(ctx) {
    const targetOptions = getRemptsTargetOptions(ctx.options);
    const report = targetOptions.cli
      ? (
          await runTargetRemptsCommand<CommandTreeReport>({
            commandPath: ["rempts", "commands", "tree"],
            cwd: ctx.cwd,
            rawTargetOptions: ctx.options,
          })
        ).data
      : (ctx.cli?.commandTree ??
        ctx.exit(1, "Command-tree diagnostics are unavailable in this CLI session."));
    const pluginDiscovery = targetOptions.cli
      ? (
          await runTargetRemptsCommand<PluginDiscoveryReport>({
            commandPath: ["rempts", "plugins", "doctor"],
            cwd: ctx.cwd,
            rawTargetOptions: ctx.options,
          })
        ).data
      : ctx.cli?.pluginDiscovery;
    const pluginMap = buildPluginMap(pluginDiscovery);

    const payload = report.nodes.map((node) => {
      const chosenPlugin =
        node.chosenCommand?.sourceKind === "plugin"
          ? pluginMap.get(node.chosenCommand.sourceId)
          : undefined;
      return {
        availableSubcommands: node.availableSubcommands,
        owner: node.chosenCommand
          ? {
              packageName: chosenPlugin?.packageName,
              sourceId: node.chosenCommand.sourceId,
              sourceKind: node.chosenCommand.sourceKind,
            }
          : undefined,
        path: node.path,
        shadowed: node.shadowedCommands.map((entry) => ({
          packageName:
            entry.sourceKind === "plugin" ? pluginMap.get(entry.sourceId)?.packageName : undefined,
          sourceId: entry.sourceId,
          sourceKind: entry.sourceKind,
        })),
      };
    });

    if (ctx.output.mode === "json") {
      ctx.output.result(payload, "rempts commands ownership");
      return;
    }

    for (const node of payload) {
      const label = node.path.length > 0 ? node.path.join(" ") : "<root>";
      const owner = node.owner
        ? `${node.owner.sourceId}${node.owner.packageName ? ` package=${node.owner.packageName}` : ""} (${node.owner.sourceKind})`
        : "(container only)";
      ctx.out(`${label}: ${owner}`);
      if (node.shadowed.length > 0) {
        ctx.out(
          `  shadowed: ${node.shadowed.map((entry) => `${entry.sourceId}${entry.packageName ? ` package=${entry.packageName}` : ""} (${entry.sourceKind})`).join(", ")}`,
        );
      }
      if (node.availableSubcommands.length > 0) {
        ctx.out(`  subcommands: ${node.availableSubcommands.join(", ")}`);
      }
    }
  },
});
