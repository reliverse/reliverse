import { definePlugin, REMPTS_PLUGIN_API_VERSION } from "@reliverse/rempts";

export default definePlugin({
  apiVersion: REMPTS_PLUGIN_API_VERSION,
  capabilities: ["fs"],
  entry: import.meta.url,
  name: "rspace-rse-plugin",
  description: "Portable home for your Rse",
  provides: ["rspace"],
});
