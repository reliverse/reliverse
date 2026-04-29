import { definePlugin, REMPTS_PLUGIN_API_VERSION } from "@reliverse/rempts";

export default definePlugin({
  apiVersion: REMPTS_PLUGIN_API_VERSION,
  capabilities: ["file-conversion", "escaping"],
  entry: import.meta.url,
  name: "toolkit-rse-plugin",
  description: "Useful tools Rse plugin for the Reliverse developer ecosystem",
  provides: ["escape"],
});
