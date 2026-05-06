import { detectArchiveFormat, normalizeArchiveFormat } from "./format";
import type { ArchiveFormat, OverwritePolicy, RelpackCommandName } from "./types";

export interface ExplainReport {
  readonly summary: string;
  readonly notes: readonly string[];
}

interface ExplainArgs {
  readonly command: RelpackCommandName;
  readonly inputs: readonly string[];
  readonly archive?: string;
  readonly output?: string;
  readonly outputDir?: string;
  readonly format?: ArchiveFormat;
  readonly overwrite: OverwritePolicy;
  readonly dryRun: boolean;
}

const COMMANDS = new Set(["doctor", "pack", "unpack", "list", "test", "verify", "diff", "explain"]);

export function explainCommand(argv: readonly string[]): ExplainReport {
  const parsed = parseExplainArgs(argv);

  if (parsed.command === "pack") {
    const format = normalizeArchiveFormat(
      parsed.format ?? detectArchiveFormat(parsed.output ?? ""),
    );
    return {
      summary: `Create a ${format} archive at ${parsed.output ?? "<missing-output>"}.`,
      notes: [
        `Inputs: ${parsed.inputs.length > 0 ? parsed.inputs.join(", ") : "<none>"}`,
        parsed.overwrite === "files"
          ? "Existing output archive may be replaced."
          : "Existing output archive will be refused.",
        parsed.dryRun
          ? "Dry run is enabled; no archive will be created."
          : "Dry run is disabled; backend command may be executed.",
      ],
    };
  }

  if (parsed.command === "unpack") {
    const format = normalizeArchiveFormat(
      parsed.format ?? detectArchiveFormat(parsed.archive ?? ""),
    );
    return {
      summary: `Extract a ${format} archive into ${parsed.outputDir ?? "."}.`,
      notes: [
        `Archive: ${parsed.archive ?? "<missing-archive>"}`,
        parsed.overwrite === "files"
          ? "Existing files may be replaced."
          : "Existing files will be refused before extraction.",
        "Archive entries are validated before extraction.",
      ],
    };
  }

  if (parsed.command === "list") {
    return { summary: `List entries in ${parsed.archive ?? "<missing-archive>"}.`, notes: [] };
  }

  if (parsed.command === "test") {
    return { summary: `Test readability of ${parsed.archive ?? "<missing-archive>"}.`, notes: [] };
  }

  if (parsed.command === "verify") {
    return {
      summary: `Verify relpack manifest in ${parsed.archive ?? "<missing-archive>"}.`,
      notes: [],
    };
  }

  if (parsed.command === "diff") {
    return {
      summary: `Compare ${parsed.archive ?? "<missing-archive>"} with ${parsed.outputDir ?? parsed.output ?? "<missing-output>"}.`,
      notes: [],
    };
  }

  if (parsed.command === "doctor") {
    return { summary: "Inspect installed archive backends and supported formats.", notes: [] };
  }

  return {
    summary: "Explain a relpack command without executing it.",
    notes: [
      "Pass a command after explain, for example: relpack explain pack ./dist -o dist.tar.zst",
    ],
  };
}

function parseExplainArgs(argv: readonly string[]): ExplainArgs {
  const [first, ...rest] = argv;
  const command = COMMANDS.has(first ?? "") ? (first as RelpackCommandName) : "explain";
  const tokens = COMMANDS.has(first ?? "") ? rest : argv;

  let output: string | undefined;
  let outputDir: string | undefined;
  let format: ArchiveFormat | undefined;
  let overwrite: OverwritePolicy = "never";
  let dryRun = false;
  const positional: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }

    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (token === "--overwrite") {
      overwrite = "files";
      continue;
    }

    if (token === "--format") {
      format = tokens[index + 1] as ArchiveFormat | undefined;
      index += 1;
      continue;
    }

    if (token.startsWith("--format=")) {
      format = token.slice("--format=".length) as ArchiveFormat;
      continue;
    }

    if (token === "-o" || token === "--output") {
      const value = tokens[index + 1];
      if (command === "unpack") {
        outputDir = value;
      } else {
        output = value;
      }
      index += 1;
      continue;
    }

    if (token.startsWith("--output=")) {
      const value = token.slice("--output=".length);
      if (command === "unpack") {
        outputDir = value;
      } else {
        output = value;
      }
      continue;
    }

    positional.push(token);
  }

  if (command === "pack") {
    const base = {
      command,
      inputs: positional,
      overwrite,
      dryRun,
    };

    if (output === undefined) {
      return format === undefined ? base : { ...base, format };
    }

    return format === undefined ? { ...base, output } : { ...base, output, format };
  }

  if (command === "unpack") {
    const base = {
      command,
      inputs: [],
      outputDir: outputDir ?? ".",
      overwrite,
      dryRun,
    };
    const archive = positional[0];

    if (archive === undefined) {
      return format === undefined ? base : { ...base, format };
    }

    return format === undefined ? { ...base, archive } : { ...base, archive, format };
  }

  if (command === "list" || command === "test" || command === "verify" || command === "diff") {
    const base = {
      command,
      inputs: [],
      overwrite,
      dryRun,
    };
    const archive = positional[0];

    if (archive === undefined) {
      return format === undefined ? base : { ...base, format };
    }

    return format === undefined ? { ...base, archive } : { ...base, archive, format };
  }

  return { command, inputs: [], overwrite, dryRun };
}
