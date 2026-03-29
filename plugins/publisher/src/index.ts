import { definePlugin } from "@reliverse/rempts";

export const publisherRsePlugin = definePlugin({
  commands: [
    {
      description: "Publish workspace packages to npm with optional prebuild via builder-rse-plugin",
      examples: [
        "rse publisher publish --targets packages/example --dry-run",
        "rse publisher publish --targets packages/example --no-prebuild --publish-from dist --dry-run",
      ],
      help:
        "Use `rse publisher publish --help` for flags. Eligible package.json: not private, type module, publishConfig.access public. Prebuild requires builder-rse-plugin on the same CLI.",
      path: ["publisher"],
    },
    {
      description: "Publish one or more packages to npm from a staging tree",
      loadCommand: () => import("./cmds/publisher/publish").then((module) => module.default),
      path: ["publisher", "publish"],
    },
  ],
  description: "npm publish helpers for the RSE CLI",
  id: "publisher-rse-plugin",
});
