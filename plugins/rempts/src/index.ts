import { definePlugin, REMPTS_PLUGIN_API_VERSION } from "@reliverse/rempts";

export default definePlugin({
  apiVersion: REMPTS_PLUGIN_API_VERSION,
  capabilities: ["plugin-diagnostics", "command-diagnostics"],
  entry: import.meta.url,
  name: "rempts-rse-plugin",
  options: {
    cli: {
      description: "Target CLI package name or bin name for explicit cross-CLI inspection.",
      type: "string",
    },
    global: {
      description: "Prefer globally installed CLI resolution for explicit cross-CLI inspection.",
      type: "boolean",
    },
    strictGlobal: {
      description: "Require global target resolution only; do not fall back to local workspace/package discovery.",
      type: "boolean",
    },
  },
  description: "Rempts host and plugin diagnostics for Rse",
  provides: ["rempts", "rempts plugins", "rempts commands"],
});
