import { definePlugin } from "@reliverse/rempts";

export default definePlugin({
  entry: import.meta.url,
  name: "pm-rse-plugin",
  description: "Bun-first package management plugin for Rse",
});
