#!/usr/bin/env bun

// 👉 bun apps/cli/src/cli.ts <cmd> <args>

import { createCLI } from "@reliverse/rempts";

const result = await createCLI({
  cwd: import.meta.dir,
  entry: import.meta.url,
  meta: {
    description: "Reliverse developer CLI that aggregates Rempts plugins.",
    name: "rse",
  },
  help: {
    examples: [
      "rse escape --input README.md --dry-run",
      "rse pm add zod --target packages/rempts --dry-run --json",
      "rse dler build --targets plugins/pm,plugins/dler,apps/cli --dry-run",
      "rse dler --help",
      "rse rempts plugins doctor --json",
      "rse pm update typescript --dry-run --json",
      "rse dler build --targets plugins/dler --provider bun --json",
    ],
    format: "auto",
  },
  interactionMode: "never",
  plugins: {
    allowedPatterns: ["@reliverse/*-rse-plugin", "@bleverse/*-rse-plugin"],
    conflictPriority: ["@reliverse/*-rse-plugin", "@bleverse/*-rse-plugin"],
  },
});

if (!result.ok) {
  process.exitCode = result.exitCode;
}
