import { definePlugin } from "@reliverse/rempts";

export const rsePmPlugin = definePlugin({
  commands: [
    {
      description: "Bun-first package-management helpers for repo and workspace package.json flows",
      examples: [
        "rse pm add zod --target packages/rempts --dry-run",
        "rse pm update --target packages/rempts --json",
        "rse pm add jest --target apps/web --catalog testing --dry-run",
        "rse pm update --cwd . --target . --dry-run --json",
        "rse pm update --cwd . --target . --no-recursive --dry-run --json",
        "rse pm update typescript --dry-run --json",
        "rse pm update typescript --no-latest --dry-run --json",
        "rse pm update vite --no-smart --dry-run --json",
      ],
      help:
        "Use `rse pm add --help` or `rse pm update --help` for the concrete mutation commands. The top-level pm scope stays lightweight and discovery-friendly, while still advertising Bun catalogs plus update defaults such as latest-by-default, smart prerelease branch handling, `--force`, and recursive-by-default root updates.",
      path: ["pm"],
    },
    {
      description: "Add new dependencies to a repo or workspace package",
      loadCommand: () => import("./cmds/pm/add").then((module) => module.default),
      path: ["pm", "add"],
    },
    {
      description: "Update dependency versions in a repo or workspace package",
      loadCommand: () => import("./cmds/pm/update").then((module) => module.default),
      path: ["pm", "update"],
    },
  ],
  description: "Package-management commands for RSE",
  id: "rse-pm-plugin",
});
