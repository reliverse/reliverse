import { definePlugin } from "@reliverse/rempts";

export const toolsRsePlugin = definePlugin({
  commands: [
    {
      description:
        "Convert files (.md, .mdc, .mdx, .json, .jsonc, .toml, .js(x), .ts(x), etc) to TypeScript with proper escaping",
      loadCommand: () => import("./cmds/escape/cmd").then((module) => module.default),
      path: [],
    },
  ],
  description: "Useful tools for the Reliverse developer ecosystem",
  id: "tools-rse-plugin",
  name: "escape",
});
