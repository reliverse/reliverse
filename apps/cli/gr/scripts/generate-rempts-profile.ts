import { resolve } from "node:path";

import { generateRemptsStaticProfile } from "@reliverse/dler-build";

const hostRoot = resolve(import.meta.dir, "..");
const receipt = await generateRemptsStaticProfile({
  allowedPluginPatterns: [],
  application: "gr",
  externalPlugins: "disabled",
  features: {
    config: false,
    doctor: false,
    frameworkDiagnostics: false,
    plugins: false,
    prompts: false,
    setup: false,
    toolBridge: false,
    tui: false,
  },
  hostRoot,
  outputFile: resolve(hostRoot, "src/rempts/generated-profile.mjs"),
  owner: "reliverse",
  pluginPackageNames: [],
});

console.log(`Generated GR packaged profile: ${receipt.commandCount} commands.`);
