import { defineCommand } from "@reliverse/rempts";

const COMMAND_NAME = "relpack";

export default defineCommand({
  meta: {
    name: COMMAND_NAME,
    description:
      "Modern archive commands for packing, unpacking, listing, testing, and explaining archive operations.",
  },
  agent: {
    notes:
      "Use relpack pack or relpack unpack with --apply when you need this plugin to write files. Read-only commands are doctor, list, test, and explain.",
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
      "rse relpack pack ./dist -o dist.tar.zst --apply",
      "rse relpack unpack dist.tar.zst -o ./out --apply",
      "rse relpack list dist.zip --json",
      "rse relpack test dist.tar.zst",
      "rse relpack explain pack ./dist -o dist.tar.zst --overwrite",
    ],
    text: "Use a relpack subcommand: doctor, pack, unpack, list, test, or explain.",
  },
  async handler(ctx) {
    ctx.out(
      [
        "relpack",
        "",
        "Usage:",
        "  rse relpack doctor [--json]",
        "  rse relpack pack <input...> -o <archive> [--format <format>] [--overwrite] [--dry-run] [--json] [--apply]",
        "  rse relpack unpack <archive> [-o <dir>] [--format <format>] [--overwrite] [--dry-run] [--json] [--apply]",
        "  rse relpack list <archive> [--format <format>] [--json]",
        "  rse relpack test <archive> [--format <format>] [--json]",
        "  rse relpack explain <command...>",
      ].join("\n"),
    );
  },
});
