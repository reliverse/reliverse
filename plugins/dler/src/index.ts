import { definePlugin, REMPTS_PLUGIN_API_VERSION } from "@reliverse/rempts";

export default definePlugin({
  apiVersion: REMPTS_PLUGIN_API_VERSION,
  capabilities: ["build", "publish", "workspace-targets"],
  entry: import.meta.url,
  name: "dler-rse-plugin",
  description: "Builder and publisher plugin for the Rse CLI",
  provides: ["build", "pub"],
});
