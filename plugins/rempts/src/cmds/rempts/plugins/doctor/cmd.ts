import { defineCommand, type PluginDiscoveryReport } from "@reliverse/rempts";
import { getRemptsTargetOptions, runTargetRemptsCommand } from "../../../../lib/target-cli";

export default defineCommand({
  meta: {
    name: "doctor",
    description: "Print a structured plugin-discovery report for the current CLI session.",
  },
  help: {
    examples: ["rse rempts plugins doctor", "rse rempts plugins doctor --json"],
    text: "Shows where plugin discovery looked, which plugins loaded, and which candidates were rejected.",
  },
  async handler(ctx) {
    const targetOptions = getRemptsTargetOptions(ctx.options);
    const report = targetOptions.cli
      ? (await runTargetRemptsCommand<PluginDiscoveryReport>({
          commandPath: ["rempts", "plugins", "doctor"],
          cwd: ctx.cwd,
          rawTargetOptions: ctx.options,
        })).data
      : ctx.cli?.pluginDiscovery ?? ctx.exit(1, "Plugin discovery metadata is unavailable in this CLI session.");

    if (ctx.output.mode === "json") {
      ctx.output.result(report, "rempts plugins doctor");
      return;
    }

    ctx.out(`CLI: ${report.cliName}`);
    ctx.out(`Host search root: ${report.hostSearchRoot}`);
    ctx.out(`Host root: ${report.hostRoot ?? "(none)"}`);
    ctx.out(`Global config: ${report.configPath}`);
    ctx.out(`Global entry: ${report.globalEntry ? "yes" : "no"}`);
    ctx.out(`Allowed patterns: ${report.allowedPatterns.join(", ") || "(none)"}`);
    ctx.out(`Conflict priority: ${report.conflictPriority.join(", ") || "(default loaded-plugin order)"}`);
    ctx.out(`Local manifest candidates: ${report.localManifestSpecifiers.join(", ") || "(none)"}`);
    ctx.out(`Global config candidates: ${report.globalConfigSpecifiers.join(", ") || "(none)"}`);
    ctx.out(`Ignored by pattern: ${report.ignored.length}`);
    for (const ignored of report.ignored) {
      ctx.out(`- ${ignored.specifier} [${ignored.source}] ${ignored.reason}`);
    }

    ctx.out(`Loaded plugins: ${report.loaded.length}`);
    for (const plugin of report.loaded) {
      ctx.out(
        `- ${plugin.pluginName} [${plugin.source}] package=${plugin.packageName} specifier=${plugin.specifier} entry=${plugin.entry}`,
      );
    }

    ctx.out(`Rejected plugins: ${report.rejected.length}`);
    for (const plugin of report.rejected) {
      ctx.out(`- ${plugin.specifier} [${plugin.source}] ${plugin.reason}`);
    }
  },
});
