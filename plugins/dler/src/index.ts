import { definePlugin } from "@reliverse/rempts";

export const builderRsePlugin = definePlugin({
  commands: [
    {
      description: "Build and/or publish one or more packages via provider-oriented subcommands",
      examples: [
        "rse dler build --dry-run",
        "rse dler build --targets plugins/pm,plugins/dler,apps/cli",
      ],
      help:
        "Use `rse dler <build|pub> --help` for the concrete build command. Note about pub: Eligible package.json: not private, type module, publishConfig.access public.",
      path: [],
    },
    {
      description: "Build one or more packages with the selected build provider",
      loadCommand: () => import("./cmds/build/cmd").then((module) => module.default),
      path: ["build"],
    },
  ],
  description: "Builder/publisher commands for the RSE CLI",
  id: "dler-rse-plugin",
  name: "dler",
});
