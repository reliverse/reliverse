import { defineCommand } from "@reliverse/rempts";

import { runRspaceVerifyCommand } from "../../../impl/verify";

export default defineCommand({
  meta: {
    name: "verify",
    description: "Verify an Rspace directory or tar.gz archive",
  },
  agent: {
    notes: "Use this subcommand before trusting an imported Rspace artifact.",
  },
  conventions: {
    idempotent: true,
    supportsApply: false,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: false,
    effects: ["fs.read"],
  },
  help: {
    examples: [
      "rse rspace verify --input ./spock.rse",
      "rse rspace verify --input /mnt/data/spock_rspace.tar.gz",
    ],
    text: "Verify an Rspace directory or tar.gz archive",
  },
  options: {
    input: {
      type: "string",
      short: "i",
      description: "Rspace directory or tar.gz archive to verify",
      inputSources: ["flag"],
    },
  },
  async handler(ctx: unknown) {
    return await runRspaceVerifyCommand(ctx);
  },
});
