import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

import { defineCommand } from "@reliverse/rempts";
import pMap from "p-map";

export default defineCommand({
  meta: {
    name: "bootstrap",
    description:
      "Bootstrap Reliverse OS",
  },
  agent: {
    notes:
      "This command is idempotent by default. Re-runs produce no-op results when outputs are already up to date, and differing existing outputs fail fast unless --overwrite is supplied.",
  },
  interactive: "never",
  conventions: {
    idempotent: true,
    supportsDryRun: true,
  },
  help: {
    examples: [
      'rse os bootstrap',
    ],
    text: "Bootstrap a Reliverse OS host.",
  },
  options: {
    dryRun: {
      type: "boolean",
      description: "Preview writes without modifying files",
      inputSources: ["flag"],
    },
    overwrite: {
      type: "boolean",
      description: "Overwrite existing output files when the generated content differs",
      inputSources: ["flag"],
    }
  },
  async handler(ctx) {},
});
