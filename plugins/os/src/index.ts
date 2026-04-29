import { definePlugin, REMPTS_PLUGIN_API_VERSION } from "@reliverse/rempts";

export default definePlugin({
  apiVersion: REMPTS_PLUGIN_API_VERSION,
  capabilities: ["os-automation", "bootstrap"],
  entry: import.meta.url,
  name: "os-rse-plugin",
  description: "OS automation plugin for the Rse CLI",
  provides: ["os"],
});
