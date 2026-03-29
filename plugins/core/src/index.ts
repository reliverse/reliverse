import { definePlugin } from "@reliverse/rempts";

export const coreRsePlugin = definePlugin({
  commands: [
    {
      description:
        "Convert files (.md, .mdc, .mdx, .json, .jsonc, .toml) to TypeScript with proper escaping",
      loadCommand: () => import("./cmds/escape").then((module) => module.default),
      path: ["escape"],
    },
    {
      description: "Read explicit text or piped stdin and return a machine-followable summary",
      loadCommand: () => import("./cmds/input").then((module) => module.default),
      path: ["input"],
    },
  ],
  description: "Core automation-friendly RSE commands",
  id: "core-rse-plugin",
});
