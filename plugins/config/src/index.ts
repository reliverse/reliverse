import { definePlugin, REMPTS_PLUGIN_API_VERSION } from "@reliverse/rempts";

import generateCommand from "./cmds/config/generate/cmd";

export default definePlugin({
  apiVersion: REMPTS_PLUGIN_API_VERSION,
  capabilities: ["config", "schema-generation"],
  commands: [{ path: ["config", "generate"], command: generateCommand }],
  entry: import.meta.url,
  name: "config-rse-plugin",
  description: "Rse config and JSON Schema generation plugin",
  provides: ["config", "config generate", "rse.config.json", "rse.config.jsonc", "rse.schema.json"],
});
