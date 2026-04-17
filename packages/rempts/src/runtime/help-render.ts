import type { RelicoInstance } from "@reliverse/relico";
import type { HelpDocument } from "./help-model";

export interface HelpRenderColors {
  readonly body: RelicoInstance;
  readonly heading: RelicoInstance;
}

const PROSE_WIDTH = 96;
const ROW_DESCRIPTION_WIDTH = 76;

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function padAnsi(value: string, width: number): string {
  const visibleLength = stripAnsi(value).length;
  return visibleLength >= width ? value : `${value}${" ".repeat(width - visibleLength)}`;
}

function wrapText(value: string, width: number): string[] {
  if (value.length <= width) {
    return [value];
  }

  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current.length === 0 ? word : `${current} ${word}`;
    if (next.length <= width) {
      current = next;
      continue;
    }

    if (current.length > 0) {
      lines.push(current);
      current = word;
      continue;
    }

    lines.push(word);
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

function formatKeyValueRows(
  rows: ReadonlyArray<{ description: string; name: string; note?: string | undefined }>,
  colors?: HelpRenderColors,
): string[] {
  if (rows.length === 0) {
    return [];
  }

  const width = Math.max(...rows.map((row) => row.name.length));

  return rows.flatMap((row) => {
    const name = padAnsi(formatPrimary(row.name, colors), width);
    const note = row.note ? ` ${colors ? colors.body.dim(row.note) : row.note}` : "";
    const wrappedDescription = wrapText(`${row.description}${note}`, ROW_DESCRIPTION_WIDTH);
    const [firstLine = "", ...rest] = wrappedDescription;
    const continuationIndent = `  ${" ".repeat(width)}  `;

    return [
      `  ${name}  ${firstLine}`,
      ...rest.map((part) => `${continuationIndent}${part}`),
    ];
  });
}

function heading(label: string, colors?: HelpRenderColors): string {
  return colors ? colors.heading.bold(colors.heading.cyanBright(label)) : label;
}

function accent(value: string, colors?: HelpRenderColors): string {
  return colors ? colors.body.bold(value) : value;
}

function formatPrimary(value: string, colors?: HelpRenderColors): string {
  return colors ? colors.body.bold(colors.body.white(value)) : value;
}

function formatMetaLabel(value: string, colors?: HelpRenderColors): string {
  return colors ? colors.body.bold(colors.body.cyan(value)) : value;
}

function subtle(value: string, colors?: HelpRenderColors): string {
  return colors ? colors.body.dim(value) : value;
}

function sectionRule(colors?: HelpRenderColors): string {
  const rule = "─".repeat(12);
  return colors ? subtle(rule, colors) : rule;
}

function bullet(colors?: HelpRenderColors): string {
  return colors ? colors.body.cyan("•") : "-";
}

function sectionSpacing(lines: string[], title: string, colors?: HelpRenderColors): void {
  lines.push("", `${heading(title, colors)} ${sectionRule(colors)}`);
}

export function renderHelpDocument(document: HelpDocument, colors?: HelpRenderColors): string {
  const banner = colors
    ? `${colors.heading.bold(colors.heading.blueBright(document.programName))} ${subtle("agent-first command runner", colors)}`
    : document.programName;
  const lines = [banner, "", heading("Usage", colors)];

  lines.push(
    ...document.usage.map((usageLine) => `  ${bullet(colors)} ${colors ? colors.body.whiteBright(usageLine) : usageLine}`),
  );

  if (document.description) {
    sectionSpacing(lines, "Description", colors);
    lines.push(...wrapText(document.description, PROSE_WIDTH).map((line) => `  ${line}`));
  }

  if (document.aliases.length > 0) {
    sectionSpacing(lines, "Aliases", colors);
    lines.push(`  ${formatPrimary(document.aliases.join(", "), colors)}`);
  }

  if (document.interactive) {
    const interactiveDescription =
      document.interactive === "never"
        ? "Disabled by default, optimized for agents and scripts"
        : document.interactive === "tty"
          ? "Plain terminal prompts available only with explicit host opt-in (for example --interactive)"
          : "TUI available only with explicit host opt-in (for example --tui), with terminal fallback when supported";

    sectionSpacing(lines, "Interaction", colors);
    lines.push(`  ${colors ? colors.body.yellow(interactiveDescription) : interactiveDescription}`);
  }

  if (document.globalFlags.length > 0) {
    sectionSpacing(lines, "Global Flags", colors);
    lines.push(
      ...formatKeyValueRows(
        document.globalFlags.map((flag) => ({ description: flag.description, name: flag.names })),
        colors,
      ),
    );
  }

  if (document.commandFlags.length > 0) {
    sectionSpacing(lines, "Command Flags", colors);

    for (const flag of document.commandFlags) {
      const requiredHint = flag.required ? "required" : undefined;
      const defaultHint = flag.defaultValue ? `default: ${flag.defaultValue}` : undefined;
      const envHint = flag.env ? `env: ${flag.env}` : undefined;
      const note = [requiredHint, defaultHint, envHint].filter(Boolean).join(" · ");

      lines.push(
        ...formatKeyValueRows(
          [{ description: flag.description, name: flag.names, note: note || undefined }],
          colors,
        ),
      );

      if (flag.hint) {
        lines.push(`    ${formatMetaLabel("hint:", colors)} ${flag.hint}`);
      }

      if (flag.inputSources && flag.inputSources.length > 0) {
        lines.push(`    ${formatMetaLabel("sources:", colors)} ${subtle(flag.inputSources.join(", "), colors)}`);
      }
    }
  }

  if (document.subcommands.length > 0) {
    sectionSpacing(lines, document.scopeLabel, colors);
    lines.push(
      ...formatKeyValueRows(
        document.subcommands.map((subcommand) => ({
          description: subcommand.description ?? "",
          name: subcommand.name,
        })),
        colors,
      ),
    );
  }

  if (document.examples.length > 0) {
    sectionSpacing(lines, "Examples", colors);
    lines.push(...document.examples.map((example) => `  ${subtle("$", colors)} ${colors ? colors.body.greenBright(example) : example}`));
  }

  if (document.agentNotes) {
    sectionSpacing(lines, "Agent Notes", colors);
    lines.push(...wrapText(document.agentNotes, PROSE_WIDTH).map((line) => `  ${line}`));
  }

  if (document.helpText) {
    sectionSpacing(lines, "Help", colors);
    lines.push(...wrapText(document.helpText, PROSE_WIDTH).map((line) => `  ${line}`));
  }

  return lines.join("\n");
}
