import { defineCommand } from "@reliverse/rempts";

import { runRspacePackCommand } from "../../../impl/pack";

export default defineCommand({
  meta: {
    name: "pack",
    description: "Pack an existing Rspace directory into a tar.gz archive",
  },
  agent: {
    notes:
      "Use this subcommand when --input already points to an existing Rspace root. Use --apply to write the archive.",
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
      "rse rspace pack --input ./spock.rse --output /mnt/data/spock_rspace.tar.gz --apply",
      "rse rspace pack --input ./spock.rse --output /mnt/data/spock_rspace.tar.gz --apply --overwrite",
    ],
    text: "Pack an existing Rspace root into a tar.gz archive",
  },
  options: {
    input: {
      type: "string",
      short: "i",
      description: "Existing Rspace directory to pack",
      inputSources: ["flag"],
    },
    output: {
      type: "string",
      short: "o",
      description: "Output tar.gz archive path",
      inputSources: ["flag"],
    },
    overwrite: {
      type: "boolean",
      description: "Allow replacing an existing archive",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    return await runRspacePackCommand(ctx);
  },
});
