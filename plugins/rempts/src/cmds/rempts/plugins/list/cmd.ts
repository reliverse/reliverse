import { defineCommand, type PluginDiscoveryLoadedPlugin } from "@reliverse/rempts";

import { getRemptsTargetOptions, runTargetRemptsCommand } from "../../../../lib/target-cli";

interface PluginListReport {
  readonly allowedPatterns: readonly string[];
  readonly cliName: string;
  readonly conflictPriority: readonly string[];
  readonly count: number;
  readonly loaded: readonly PluginDiscoveryLoadedPlugin[];
}

export default defineCommand({
  meta: {
    name: "list",
    description: "List plugins currently loaded for this CLI session.",
  },
  help: {
    examples: ["rse rempts plugins list", "rse rempts plugins list --json"],
  },
  async handler(ctx) {
    const targetOptions = getRemptsTargetOptions(ctx.options);
    const usingTarget = Boolean(targetOptions.cli);
    const report = usingTarget
      ? (
          await runTargetRemptsCommand<PluginListReport>({
            commandPath: ["rempts", "plugins", "list"],
            cwd: ctx.cwd,
            rawTargetOptions: ctx.options,
          })
        ).data
      : ctx.cli?.pluginDiscovery
        ? {
            allowedPatterns: ctx.cli.pluginDiscovery.allowedPatterns,
            cliName: ctx.cli.pluginDiscovery.cliName,
            conflictPriority: ctx.cli.pluginDiscovery.conflictPriority,
            count: ctx.cli.pluginDiscovery.loaded.length,
            loaded: ctx.cli.pluginDiscovery.loaded,
          }
        : ctx.exit(1, "Plugin discovery metadata is unavailable in this CLI session.");

    const payload = {
      allowedPatterns: report.allowedPatterns,
      cliName: report.cliName,
      conflictPriority: report.conflictPriority,
      count: report.count,
      loaded: report.loaded,
    };

    if (ctx.output.mode === "json") {
      ctx.output.result(payload, "rempts plugins list");
      return;
    }

    ctx.out(`CLI: ${report.cliName}`);
    ctx.out(`Allowed patterns: ${report.allowedPatterns.join(", ") || "(none)"}`);
    ctx.out(
      `Conflict priority: ${report.conflictPriority.join(", ") || "(default loaded-plugin order)"}`,
    );
    if (report.count === 0) {
      ctx.out("Loaded plugins: none");
      return;
    }

    ctx.out(`Loaded plugins (${report.count}):`);
    for (const plugin of report.loaded) {
      const priority = plugin.priorityMatch
        ? ` priority=${plugin.priorityMatch.kind}:${plugin.priorityMatch.rule}@${plugin.priorityMatch.index}`
        : "";
      ctx.out(
        `- ${plugin.pluginName} [${plugin.source}] package=${plugin.packageName} specifier=${plugin.specifier} apiVersion=${plugin.apiVersion}${priority}`,
      );
    }
  },
});
