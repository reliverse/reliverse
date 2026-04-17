#!/usr/bin/env bun

// 👉 bun apps/cli/src/cli.ts <cmd> <args>

import { createCLI } from "@reliverse/rempts";

const result = await createCLI({
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
      "rse pm update typescript --dry-run --json",
      "rse dler build --targets plugins/dler --provider bun --json",
    ],
    format: "auto",
  },
  interactionMode: "never",
  plugins: {
    supportPlugins: true,
    allowedPatterns: ["@reliverse/*-rse-plugin"],
  },
});

if (!result.ok) {
  process.exitCode = result.exitCode;
}
