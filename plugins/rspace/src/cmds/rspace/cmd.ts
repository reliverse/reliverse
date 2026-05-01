import { defineCommand } from "@reliverse/rempts";

import { runRspaceCreateCommand } from "../../impl/runner";

const COMMAND_NAME = "rspace";

export default defineCommand({
  meta: {
    name: COMMAND_NAME,
    description: "Create a portable home for your Rse",
  },
  agent: {
    notes:
      "Use --apply when you need this command to write files. --name is required. --team is required unless --custom-path is provided.",
  },
  conventions: {
    idempotent: true,
    supportsApply: true,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.write"],
  },
  help: {
    examples: [
      "rse rspace --name spock --team reliverse --output ./spock.rse --apply",
      "rse rspace --name spock --team reliverse --input ~/.openclaw/teams/reliverse/spock --output ./spock.rse --platform openclaw --apply",
      "rse rspace --name spock --custom-path .rse/imports/spock --input ./spock --output ./spock.rse --apply",
      "rse rspace --name spock --team reliverse --entry-file README_FIRST --output ./spock.rse --apply",
    ],
    text: "Create a provider-agnostic portable home for your Rse",
  },
  options: {
    input: {
      type: "string",
      short: "i",
      description: "Input directory to import into the Rspace",
      inputSources: ["flag"],
    },
    output: {
      type: "string",
      short: "o",
      description: "Output directory path",
      inputSources: ["flag"],
    },
    name: {
      type: "string",
      short: "n",
      description: "Rspace agent name. Required.",
      inputSources: ["flag"],
    },
    team: {
      type: "string",
      short: "t",
      description: "Team name used for .rse/teams/<team>/<agent>. Required unless --custom-path is provided.",
      inputSources: ["flag"],
    },
    "custom-path": {
      type: "string",
      description:
        "Custom relative import target path inside the Rspace. Disables the --team requirement.",
      inputSources: ["flag"],
    },
    "entry-file": {
      type: "string",
      description: "Entry file name/path to generate instead of START_HERE.md",
      inputSources: ["flag"],
    },
    platform: {
      type: "string",
      description: "Target platform: generic, chatgpt, openclaw, or bleverse",
      inputSources: ["flag"],
    },
    "optimize-for-platform": {
      type: "string",
      description: "Alias for --platform",
      inputSources: ["flag"],
    },
    overwrite: {
      type: "boolean",
      description: "Allow replacing an existing output directory",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    return await runRspaceCreateCommand(ctx);
  },
});
