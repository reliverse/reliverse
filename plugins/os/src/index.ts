import { definePlugin } from "@reliverse/rempts";

export const osRsePlugin = definePlugin({
  commands: [
    {
      description: "Bootstrap Reliverse OS hosts",
      loadCommand: () => import("./cmds/bootstrap/cmd").then((module) => module.default),
      path: ["bootstrap"],
    },
  ],
  description: "OS automation commands for RSE",
  id: "os-rse-plugin",
  name: "os",
});
