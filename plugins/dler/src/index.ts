import { definePlugin } from "@reliverse/rempts";

export default definePlugin({
  entry: import.meta.url,
  name: "dler-rse-plugin",
  description: "Builder and publisher plugin for the Rse CLI",
});
