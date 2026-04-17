import type { HelpDocument } from "./help-model";

export function renderHelpDocument(document: HelpDocument): string {
  const lines = ["Usage"];

  lines.push(...document.usage.map((usageLine) => `  ${usageLine}`));

  if (document.description) {
    lines.push("", "Description", `  ${document.description}`);
  }

  if (document.aliases.length > 0) {
    lines.push("", "Aliases", `  ${document.aliases.join(", ")}`);
  }

  if (document.interactive) {
    const interactiveDescription =
      document.interactive === "never"
        ? "Disabled by default, optimized for agents and scripts"
        : document.interactive === "tty"
          ? "Plain terminal prompts available only with explicit host opt-in (for example --interactive)"
          : "TUI available only with explicit host opt-in (for example --tui), with terminal fallback when supported";

    lines.push("", "Interaction", `  ${interactiveDescription}`);
  }

  if (document.globalFlags.length > 0) {
    lines.push("", "Global Flags");

    for (const flag of document.globalFlags) {
      lines.push(`  ${flag.names}`);
      lines.push(`    ${flag.description}`);
    }
  }

  if (document.commandFlags.length > 0) {
    lines.push("", "Command Flags");

    for (const flag of document.commandFlags) {
      const requiredHint = flag.required ? " (required)" : "";
      const defaultHint = flag.defaultValue ? ` [default: ${flag.defaultValue}]` : "";
      const envHint = flag.env ? ` [env: ${flag.env}]` : "";

      lines.push(`  ${flag.names}`);
      lines.push(`    ${flag.description}${requiredHint}${defaultHint}${envHint}`);

      if (flag.hint) {
        lines.push(`    hint: ${flag.hint}`);
      }

      if (flag.inputSources && flag.inputSources.length > 0) {
        lines.push(`    sources: ${flag.inputSources.join(", ")}`);
      }
    }
  }

  if (document.subcommands.length > 0) {
    lines.push("", document.scopeLabel);

    for (const subcommand of document.subcommands) {
      const description = subcommand.description ? ` - ${subcommand.description}` : "";
      lines.push(`  ${subcommand.name}${description}`);
    }
  }

  if (document.examples.length > 0) {
    lines.push("", "Examples");
    lines.push(...document.examples.map((example) => `  ${example}`));
  }

  if (document.agentNotes) {
    lines.push("", "Agent Notes", `  ${document.agentNotes}`);
  }

  if (document.helpText) {
    lines.push("", "Help", `  ${document.helpText}`);
  }

  return lines.join("\n");
}
