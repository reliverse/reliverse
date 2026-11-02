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
    examples: ["rse --help", "rse dler build --help", "rse dler tsc --help"],
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
