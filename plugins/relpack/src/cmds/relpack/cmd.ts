import { defineCommand } from "@reliverse/rempts";

const COMMAND_NAME = "relpack";

export default defineCommand({
  meta: {
    name: COMMAND_NAME,
    description:
      "Modern archive commands for packing, unpacking, listing, testing, verifying, diffing, and explaining archive operations.",
  },
  agent: {
    notes:
      "Use relpack pack or relpack unpack with --apply when you need this plugin to write files. Read-only commands are doctor, list, test, verify, diff, and explain.",
  },
  conventions: {
    idempotent: true,
    supportsApply: true,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: false,
    effects: ["fs.read", "fs.write"],
  },
  help: {
    examples: [
      "rse relpack doctor",
      "rse relpack pack ./dist -o dist.tar.zst",
      "rse relpack pack ./dist -o dist.tar.zst --apply",
      "rse relpack unpack dist.tar.zst -o ./out",
      "rse relpack unpack dist.tar.zst -o ./out --apply",
      "rse relpack list dist.zip --tree --max-depth 3",
      "rse relpack test dist.tar.zst",
      "rse relpack verify dist.zip",
      "rse relpack diff dist.zip -o ./out",
      "rse relpack explain pack ./dist -o dist.tar.zst --overwrite",
    ],
    text: "Use a relpack subcommand: doctor, pack, unpack, list, test, verify, diff, or explain.",
  },
  async handler(ctx) {
    ctx.out(
      [
        "Relpack",
        "",
        "Status: command group ready — choose a subcommand below.",
        "",
        "Write commands:",
        "  rse relpack pack <input...> -o <archive> [--format <format>] [--overwrite] [--dry-run] [--json] [--apply]",
        "  rse relpack unpack <archive> [-o <dir>] [--format <format>] [--overwrite-mode never|files|clean] [--backup] [--rollback-on-fail] [--post-check-command <cmd>] [--dry-run] [--json] [--apply]",
        "",
        "Read-only commands:",
        "  rse relpack doctor [--json]",
        "  rse relpack list <archive> [--format <format>] [--tree] [--max-depth <n>] [--json]",
        "  rse relpack test <archive> [--format <format>] [--json]",
        "  rse relpack verify <archive> [--format <format>] [--json]",
        "  rse relpack diff <archive> -o <dir> [--format <format>] [--json]",
        "  rse relpack explain <command...>",
        "",
        "Important flags:",
        "  --apply      Actually write files. Without it, pack/unpack stay in preview mode.",
        "  --overwrite  Shorthand for file-level overwrite. Still requires --apply.",
        "  --overwrite-mode never|files|clean  Choose unpack collision behavior explicitly.",
        "  --backup     Backup output before unpacking.",
        "  --rollback-on-fail  Restore backup when extraction or post-check fails.",
        "  --dry-run    Force preview-only mode.",
        "  --json       Print machine-readable output.",
        "",
        "What to do next:",
        "  1. Check your environment: rse relpack doctor",
        "  2. Preview packing: rse relpack pack ./dist -o dist.tar.zst",
        "  3. Create the archive: rse relpack pack ./dist -o dist.tar.zst --apply",
      ].join("\n"),
    );
  },
});
