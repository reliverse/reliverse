import type { RelpackCommandName } from "./core/types";

interface DirectCommandHelp {
  readonly usage: string;
  readonly summary: string;
  readonly flags?: readonly string[];
  readonly examples?: readonly string[];
  readonly notes?: readonly string[];
}

const COMMON_FLAGS = [
  "--json                   Print machine-readable output.",
  "--format <format>        Override archive format when filename inference is not enough.",
];

const DIRECT_COMMAND_HELP: Record<RelpackCommandName, DirectCommandHelp> = {
  doctor: {
    usage: "relpack doctor [--json]",
    summary: "Inspect installed archive backends and supported formats.",
    examples: ["relpack doctor", "relpack doctor --json"],
  },
  pack: {
    usage: "relpack pack <input...> -o <archive> [flags]",
    summary: "Create an archive. Preview is the default; pass --apply to write.",
    flags: [
      "-o, --output <archive>   Output archive path. Required.",
      "--apply                  Actually create the archive.",
      "--overwrite              Allow replacing an existing output archive.",
      "--dry-run                Force preview mode even when --apply is present.",
      "--ignore <names>         Comma-separated extra file/directory names to skip.",
      "--include-ignored        Disable relpack's default junk/secret ignore list.",
      "--show-skipped           Show skipped path examples in human output.",
      "--no-manifest            Do not embed .relpack/manifest.json.",
      ...COMMON_FLAGS,
    ],
    examples: [
      "relpack pack ./plugins/relpack -o relpack-0.1.3.zip",
      "relpack pack ./plugins/relpack -o relpack-0.1.3.zip --apply",
      "relpack pack . -o repo.zip --show-skipped",
    ],
  },
  unpack: {
    usage: "relpack unpack <archive...> -o <dir...> [flags]",
    summary: "Safely extract one or more archives. Preview is the default; pass --apply to write.",
    flags: [
      "-o, --output <dir...>    Output directory/directories. Required for safe updates.",
      "--apply                  Actually extract files.",
      "--overwrite              Shorthand for --overwrite-mode files.",
      "--overwrite-mode <mode>  never, files, or clean.",
      "--backup                 Backup output before extraction.",
      "--rollback-on-fail       Restore backups if extraction or post-check fails.",
      "--post-check-command <cmd> Run once after extraction and before deleting archives.",
      "--delete-archive         Delete source archives after successful extraction/post-check.",
      "--clean-output           Legacy alias for clean output behavior; prefer --overwrite-mode clean.",
      "--dry-run                Force preview mode.",
      ...COMMON_FLAGS,
    ],
    examples: [
      "relpack unpack './relpack-*.zip' -o ./plugins/relpack",
      "relpack unpack './relpack-*.zip' -o ./plugins/relpack --overwrite-mode clean --backup --rollback-on-fail --apply",
      "relpack unpack './rse-*.zip' './relpack-*.zip' -o ./apps/rse ./plugins/relpack --overwrite-mode clean --backup --rollback-on-fail --post-check-command 'bun test apps/rse plugins/relpack' --delete-archive --apply",
    ],
    notes: [
      "Batch mode maps resolved archives to output directories by order.",
      "Archive globs are resolved by relpack, so quote them in package scripts for predictable behavior.",
    ],
  },
  list: {
    usage: "relpack list <archive> [--tree] [--max-depth <n>] [--json]",
    summary: "Show archive contents, summary stats, manifest info, and next actions.",
    flags: [
      "--tree                   Show a compact tree view.",
      "--max-depth <n>          Limit tree depth.",
      ...COMMON_FLAGS,
    ],
    examples: [
      "relpack list relpack-0.1.3.zip",
      "relpack list './relpack-*.zip' --tree --max-depth 3",
    ],
  },
  test: {
    usage: "relpack test <archive> [--json]",
    summary: "Ask the selected backend to test whether the archive is readable.",
    flags: COMMON_FLAGS,
    examples: ["relpack test relpack-0.1.3.zip", "relpack test './relpack-*.zip' --json"],
  },
  verify: {
    usage: "relpack verify <archive> [--json]",
    summary: "Verify archive entries against .relpack/manifest.json.",
    flags: COMMON_FLAGS,
    examples: ["relpack verify relpack-0.1.3.zip", "relpack verify './relpack-*.zip' --json"],
  },
  diff: {
    usage: "relpack diff <archive> -o <dir> [flags]",
    summary: "Compare an archive with an output directory before extraction.",
    flags: [
      "-o, --output <dir>       Directory to compare against. Required.",
      "--ignore <names>         Comma-separated extra output names to ignore.",
      "--include-ignored        Disable default ignored names while finding removed files.",
      ...COMMON_FLAGS,
    ],
    examples: [
      "relpack diff relpack-0.1.3.zip -o ./plugins/relpack",
      "relpack diff './relpack-*.zip' -o ./plugins/relpack",
    ],
  },
  explain: {
    usage: "relpack explain <command...>",
    summary: "Explain what a relpack command would do without executing it.",
    examples: [
      "relpack explain pack ./dist -o dist.tar.zst",
      "relpack explain unpack dist.zip -o ./out --overwrite",
    ],
  },
};

export function formatDirectRootHelp(): string {
  return [
    "Relpack",
    "",
    "Usage:",
    "  relpack <command> [args] [flags]",
    "  relpack help <command>",
    "  relpack <command> --help",
    "  relpack --version",
    "",
    "Commands:",
    "  doctor   Inspect installed archive backends.",
    "  pack     Create an archive. Preview-first; use --apply to write.",
    "  unpack   Safely extract one or more archives.",
    "  list     Show archive contents and manifest summary.",
    "  test     Ask the backend to test archive readability.",
    "  verify   Verify archive entries against relpack manifest.",
    "  diff     Compare archive contents with an output directory.",
    "  explain  Explain a relpack command without executing it.",
    "",
    "Important flags:",
    "  --apply                  Actually write files. Without it, pack/unpack preview only.",
    "  --overwrite-mode MODE    never, files, or clean.",
    "  --backup                 Backup output before unpacking.",
    "  --rollback-on-fail       Restore backups if extraction or post-check fails.",
    "  --post-check-command CMD Run once after extraction and before deleting source archives.",
    "  --delete-archive         Delete source archives only after successful extraction/post-check.",
    "  --json                   Print machine-readable output.",
    "",
    "Examples:",
    "  relpack doctor",
    "  relpack pack ./plugins/relpack -o relpack-0.1.3.zip --apply",
    "  relpack unpack './relpack-*.zip' -o ./plugins/relpack --overwrite-mode clean --backup --rollback-on-fail --apply",
    "",
    "Wrapper-compatible:",
    "  The same commands continue to work through: rse relpack <command> ...",
  ].join("\n");
}

export function formatDirectCommandHelp(command: RelpackCommandName): string {
  const help = DIRECT_COMMAND_HELP[command];
  const lines = ["Relpack", "", `Usage:`, `  ${help.usage}`, "", help.summary];

  if (help.flags && help.flags.length > 0) {
    lines.push("", "Flags:", ...help.flags.map((flag) => `  ${flag}`));
  }

  if (help.examples && help.examples.length > 0) {
    lines.push("", "Examples:", ...help.examples.map((example) => `  ${example}`));
  }

  if (help.notes && help.notes.length > 0) {
    lines.push("", "Notes:", ...help.notes.map((note) => `  - ${note}`));
  }

  lines.push("", "Wrapper-compatible:", `  rse relpack ${command} ...`);

  return lines.join("\n");
}
