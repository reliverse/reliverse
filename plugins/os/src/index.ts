import { definePlugin } from "@reliverse/rempts";

export default definePlugin({
  entry: import.meta.url,
  name: "os-rse-plugin",
  description: "OS automation plugin for the Rse CLI",
});
