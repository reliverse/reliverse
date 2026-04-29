#!/usr/bin/env bun

// 👉 bun apps/rse/src/cli.ts <cmd> <args>

import { createCLI } from "@reliverse/rempts";

const result = await createCLI({
  entry: import.meta.url,
  meta: {
    description: "Reliverse developer CLI that aggregates Rempts plugins",
    name: "rse",
  },
  help: {
    examples: [
      "rse escape --input README.md",
      "rse add zod --target packages/rempts --json",
      "rse build --targets plugins/pm,plugins/dler,apps/rse",
      "rse build --help",
      "rse rempts plugins doctor --json",
      "rse update typescript --json",
      "rse build --targets plugins/dler --provider bun --json",
    ],
    format: "auto",
  },
  interactionMode: "never",
  plugins: {
    allowedPatterns: ["@reliverse/*-rse-plugin"],
    conflictPriority: ["@reliverse/*-rse-plugin"],
    cwd: import.meta.dir,
  },
});

if (!result.ok) {
  process.exitCode = result.exitCode;
}
