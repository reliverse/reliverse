import { definePlugin, REMPTS_PLUGIN_API_VERSION } from "@reliverse/rempts";

export default definePlugin({
  apiVersion: REMPTS_PLUGIN_API_VERSION,
  capabilities: ["package-management", "dependency-add", "dependency-update"],
  config: {
    defaults: {
      pm: {
        safeLatest: {
          allowFreshScopes: ["@reliverse/*"],
          blockDeprecated: true,
          blockInstallScripts: "unlessAllowlisted",
          installScriptAllowlist: [],
          maxFallbackDepth: 20,
          minimumReleaseAgeDays: 7,
        },
      },
    },
    schema: {
      properties: {
        pm: {
          type: "object",
          additionalProperties: false,
          description: "Configuration consumed by @reliverse/pm-rse-plugin.",
          properties: {
            safeLatest: {
              type: "object",
              additionalProperties: false,
              description: "Policy defaults for rse update --safe-latest.",
              properties: {
                allowFreshScopes: {
                  type: "array",
                  description:
                    "Package names or scope globs allowed to bypass the safe-latest release-age gate.",
                  items: { type: "string" },
                  default: ["@reliverse/*"],
                },
                blockDeprecated: {
                  type: "boolean",
                  description: "Block npm versions marked as deprecated.",
                  default: true,
                },
                blockInstallScripts: {
                  type: "string",
                  description: "Install-script policy for candidate package versions.",
                  enum: ["always", "unlessAllowlisted", "warn"],
                  default: "unlessAllowlisted",
                },
                installScriptAllowlist: {
                  type: "array",
                  description:
                    "Package names allowed to keep install scripts when blockInstallScripts is unlessAllowlisted.",
                  items: { type: "string" },
                  default: [],
                },
                maxFallbackDepth: {
                  type: "number",
                  description: "Maximum older stable versions checked by safe-latest.",
                  minimum: 1,
                  default: 20,
                },
                minimumReleaseAgeDays: {
                  type: "number",
                  description: "Minimum candidate release age in days.",
                  minimum: 0,
                  default: 7,
                },
              },
            },
          },
        },
      },
    },
  },
  entry: import.meta.url,
  name: "pm-rse-plugin",
  description: "Bun-first package management plugin for Rse",
  provides: ["add", "update"],
});
