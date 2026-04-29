import { defineCommand } from "@reliverse/rempts";

export default defineCommand({
  meta: {
    name: "plugins",
    description: "Inspect plugin discovery, loaded plugins, and rejected plugin candidates.",
  },
  help: {
    examples: ["rse rempts plugins list", "rse rempts plugins doctor"],
  },
  async handler() {
    return undefined;
  },
});
