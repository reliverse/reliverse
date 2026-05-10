import { definePlugin, REMPTS_PLUGIN_API_VERSION } from "@reliverse/rempts";

import buildCommand from "./cmds/build/cmd";
import pubCommand from "./cmds/pub/cmd";

export default definePlugin({
  apiVersion: REMPTS_PLUGIN_API_VERSION,
  capabilities: ["build", "publish", "workspace-targets"],
  commands: [
    { path: ["build"], command: buildCommand },
    { path: ["pub"], command: pubCommand },
  ],
  entry: import.meta.url,
  name: "dler-rse-plugin",
  description: "Builder and publisher plugin for the Rse CLI",
  provides: ["build", "pub"],
});
