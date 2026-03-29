#!/usr/bin/env bun

// 👉 bun apps/cli/src/cli.ts <cmd> <args>

import { createCLI } from "@reliverse/rempts";

const result = await createCLI({
  description: "Reliverse developer CLI that aggregates Rempts plugins.",
  entry: import.meta.url,
  examples: [
    "rse escape --input README.md --dry-run",
    "rse pm add zod --target packages/rempts --dry-run --json",
    "rse builder build --targets plugins/pm,plugins/builder,apps/cli --dry-run",
    "rse publisher publish --targets packages/rempts --no-prebuild --publish-from src --dry-run --tag next",
    'rse input --text "hello rempts"',
    "printf '{\"name\":\"reliverse\"}' | rse input --stdin --format json --json",
  ],
  helpFormat: "auto",
  hostPlugins: true,
  name: "rse",
});

if (!result.ok) {
  process.exitCode = result.exitCode;
}
