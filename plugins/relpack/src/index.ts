import { definePlugin, REMPTS_PLUGIN_API_VERSION } from "@reliverse/rempts";

export default definePlugin({
  apiVersion: REMPTS_PLUGIN_API_VERSION,
  capabilities: ["fs"],
  entry: import.meta.url,
  name: "relpack-rse-plugin",
  description:
    "Modern archive CLI for packing, unpacking, listing, testing, verifying, diffing, and explaining archive operations.",
  provides: ["relpack"],
});
