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
      "rse builder build --targets plugins/pm,plugins/builder,apps/cli --dry-run",
      "rse publisher publish --targets packages/rempts --no-prebuild --publish-from src --dry-run --tag next",
      'rse input --text "hello rempts"',
      "printf '{\"name\":\"reliverse\"}' | rse input --stdin --format json --json",
    ],
    format: "auto",
  },
  plugins: {
    supportPlugins: true,
    allowedPatterns: ["@reliverse/*-rse-plugin"],
  },
});

if (!result.ok) {
  process.exitCode = result.exitCode;
}
