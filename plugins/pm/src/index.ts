import { definePlugin, REMPTS_PLUGIN_API_VERSION } from "@reliverse/rempts";

export default definePlugin({
  apiVersion: REMPTS_PLUGIN_API_VERSION,
  capabilities: ["package-management", "dependency-add", "dependency-update"],
  entry: import.meta.url,
  name: "pm-rse-plugin",
  description: "Bun-first package management plugin for Rse",
  provides: ["add", "update"],
});
