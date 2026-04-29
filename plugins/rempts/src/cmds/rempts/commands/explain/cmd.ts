import {
  defineCommand,
  type CommandTreeNodeDiagnostic,
  type CommandTreeReport,
  type PluginDiscoveryLoadedPlugin,
  type PluginDiscoveryReport,
} from "@reliverse/rempts";
import { getRemptsTargetOptions, runTargetRemptsCommand } from "../../../../lib/target-cli";

function parsePath(args: readonly string[]): readonly string[] {
  return args.flatMap((arg) => arg.split("/").filter(Boolean));
}

function findNode(report: CommandTreeReport, path: readonly string[]): CommandTreeNodeDiagnostic | undefined {
  return report.nodes.find((node) => node.path.length === path.length && node.path.every((segment, index) => segment === path[index]));
}

function buildPluginMap(report: PluginDiscoveryReport | undefined): Map<string, PluginDiscoveryLoadedPlugin> {
  return new Map((report?.loaded ?? []).map((plugin) => [plugin.pluginName, plugin] as const));
}

export default defineCommand({
  meta: {
    name: "explain",
    description: "Explain ownership, precedence, and merged subcommands for a command path.",
  },
  help: {
    examples: [
      "rse rempts commands explain build",
      "rse rempts commands explain rempts/plugins/list",
      "rse rempts commands explain build --cli rse --json",
    ],
    text: "Pass a command path as space-separated args or a slash-separated path.",
  },
  async handler(ctx) {
    const path = parsePath(ctx.args);
    if (path.length === 0) {
      ctx.exit(1, "Expected a command path to explain, e.g. `rempts commands explain build`.");
    }

    const targetOptions = getRemptsTargetOptions(ctx.options);
    const commandTree = targetOptions.cli
      ? (await runTargetRemptsCommand<CommandTreeReport>({
          commandPath: ["rempts", "commands", "tree"],
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

    const node = findNode(commandTree, path);
    if (!node) {
      ctx.exit(1, `Command path \"${path.join(" ")}\" was not found in the merged command tree.`);
    }
    const resolvedNode = node!;

    const pluginMap = buildPluginMap(pluginDiscovery);
    const chosenPlugin = resolvedNode.chosenCommand?.sourceKind === "plugin"
      ? pluginMap.get(resolvedNode.chosenCommand.sourceId)
      : undefined;
    const payload = {
      availableSubcommands: resolvedNode.availableSubcommands,
      chosenCommand: resolvedNode.chosenCommand,
      path,
      precedenceReason: chosenPlugin?.priorityMatch
        ? `${chosenPlugin.priorityMatch.kind}:${chosenPlugin.priorityMatch.rule}@${chosenPlugin.priorityMatch.index}`
        : resolvedNode.chosenCommand?.sourceKind === "plugin"
          ? "default loaded-plugin order"
          : resolvedNode.chosenCommand
            ? `${resolvedNode.chosenCommand.sourceKind} source precedence`
            : "container only",
      shadowedCommands: resolvedNode.shadowedCommands,
      subcommandDiagnostics: resolvedNode.subcommandDiagnostics,
    };

    if (ctx.output.mode === "json") {
      ctx.output.result(payload, "rempts commands explain");
      return;
    }

    ctx.out(`Path: ${path.join(" ")}`);
    ctx.out(`Chosen: ${resolvedNode.chosenCommand ? `${resolvedNode.chosenCommand.sourceId} (${resolvedNode.chosenCommand.sourceKind})` : "(container only)"}`);
    ctx.out(`Precedence: ${payload.precedenceReason}`);
    if (resolvedNode.shadowedCommands.length > 0) {
      ctx.out(`Shadowed: ${resolvedNode.shadowedCommands.map((entry) => `${entry.sourceId} (${entry.sourceKind})`).join(", ")}`);
    }
    if (resolvedNode.availableSubcommands.length > 0) {
      ctx.out(`Available subcommands: ${resolvedNode.availableSubcommands.join(", ")}`);
    }
    const merged = resolvedNode.subcommandDiagnostics.filter((entry) => entry.sources.length > 1);
    if (merged.length > 0) {
      ctx.out("Merged subcommand ownership:");
      for (const entry of merged) {
        ctx.out(`- ${entry.name}: ${entry.sources.join(", ")}`);
      }
    }
  },
});
