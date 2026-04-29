import { defineCommand } from "@reliverse/rempts";

export default defineCommand({
  meta: {
    name: "commands",
    description: "Inspect merged command-tree state for the current CLI session.",
  },
  help: {
    examples: ["rse rempts commands tree", "rse rempts commands doctor --json", "rse rempts commands explain build", "rse rempts commands ownership"],
  },
  async handler() {
    return undefined;
  },
});
