#!/usr/bin/env bun

// 👉 bun apps/rse/src/cli.ts <cmd> <args>

import path from "node:path";

const cliPackageRoot = path.resolve(import.meta.dir, "..");

let createCLI: typeof import("@reliverse/rempts").createCLI;

try {
  ({ createCLI } = await import("@reliverse/rempts"));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    [
      "rse could not start because @reliverse/rempts is not available.",
      "",
      "What to do next:",
      "  1. Run this command from the Reliverse monorepo after installing workspace dependencies.",
      "  2. Usually that means: bun install",
      "  3. Then retry: bun apps/rse/src/cli.ts --help",
      "",
      "Details:",
      `  ${message}`,
    ].join("\n"),
  );
  process.exit(1);
}

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
      "rse relpack doctor",
      "rse relpack unpack './rse-*.zip' './relpack-*.zip' -o ./apps/rse ./plugins/relpack --overwrite-mode clean --backup --rollback-on-fail --post-check-command 'bun test apps/rse plugins/relpack' --delete-archive --apply",
      "rse update typescript --json",
      "rse build --targets plugins/dler --provider bun --json",
    ],
    format: "auto",
  },
  interactionMode: "never",
  plugins: {
    allowedPatterns: ["@reliverse/*-rse-plugin"],
    conflictPriority: ["@reliverse/*-rse-plugin"],
    cwd: cliPackageRoot,
  },
});

if (!result.ok) {
  process.exitCode = result.exitCode;
}
