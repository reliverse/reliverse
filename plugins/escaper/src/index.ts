import { definePlugin } from "@reliverse/rempts";

export const escaperRsePlugin = definePlugin({
  commands: [
    {
      description:
        "Convert files (.md, .mdc, .mdx, .json, .jsonc, .toml) to TypeScript with proper escaping",
      loadCommand: () => import("./cmds/escape").then((module) => module.default),
      path: ["escape"],
    },
  ],
  description: "Escaper RSE commands",
  id: "escaper-rse-plugin",
});
