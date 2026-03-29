import { definePlugin } from "@reliverse/rempts";

export const builderRsePlugin = definePlugin({
  commands: [
    {
      description: "Build Reliverse workspaces via provider-oriented subcommands",
      examples: [
        "rse builder build --dry-run",
        "rse builder build --targets plugins/pm,plugins/builder,apps/cli",
      ],
      help:
        "Use `rse builder build --help` for the concrete build command. The top-level builder scope stays lightweight and discovery-friendly.",
      path: ["builder"],
    },
    {
      description: "Build one or more Reliverse workspaces with the Bun build provider",
      loadCommand: () => import("./cmds/builder/build").then((module) => module.default),
      path: ["builder", "build"],
    },
  ],
  description: "Builder commands for the RSE CLI",
  id: "builder-rse-plugin",
});
