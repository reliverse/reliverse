import { RELIVERSE_HOME_CONTRIBUTION_SCHEMA, type ReliverseHomeContributionV0 } from "./model";

function contribution(
  value: Omit<ReliverseHomeContributionV0, "schema">,
): ReliverseHomeContributionV0 {
  return Object.freeze({ schema: RELIVERSE_HOME_CONTRIBUTION_SCHEMA, ...value });
}

export const RELIVERSE_HOME_CONTRIBUTIONS = Object.freeze([
  contribution({
    id: "reliverse-core",
    root: ".",
    authored: [
      "home.json",
      ".gitignore",
      ".reliverse-hooks/pre-commit",
      "principals/prn_*/principal.json",
    ],
    generated: [],
    mutable: ["store/**", "objects/**"],
    sensitive: ["secrets/**"],
  }),
  contribution({
    id: "rse",
    root: "rse",
    authored: [".config/rse.json", "agents/prn_*/agt_*/src/**"],
    generated: [
      "agents/prn_*/agt_*/compiled/**",
      "agents/prn_*/agt_*/home/**",
      "agents/prn_*/agt_*/skills/**",
      "agents/prn_*/agt_*/evals/**",
      "agents/prn_*/agt_*/flows/**",
      "agents/prn_*/agt_*/projections/**",
      "agents/prn_*/agt_*/agent.lock",
    ],
    mutable: [
      "agents/prn_*/agt_*/state/**",
      "agents/prn_*/agt_*/receipts/**",
      "agents/prn_*/agt_*/cache/**",
      "spaces/**",
      "sandboxes/**",
      "gateway/**",
      "registry/**",
      "providers/**",
      "state/**",
      "receipts/**",
      "cache/**",
      "logs/**",
      "tmp/**",
      "plugins/**",
    ],
    sensitive: ["secrets/**", "**/*.token", "**/*.credentials.json"],
  }),
  contribution({
    id: "rempts",
    root: "rempts",
    authored: ["config.json"],
    generated: [],
    mutable: ["artifacts/**", "state/**", "cache/**", "logs/**", "tmp/**"],
    sensitive: ["secrets/**", "**/*.token"],
  }),
  contribution({
    id: "dcs",
    root: "dcs",
    authored: ["config.jsonc"],
    generated: ["projections/**"],
    mutable: ["state/**", "receipts/**", "cache/**", "locks/**"],
    sensitive: ["secrets/**", "**/*.credentials.json"],
  }),
] as const);

export function validateReliverseHomeContribution(
  input: ReliverseHomeContributionV0,
): readonly string[] {
  const diagnostics: string[] = [];
  if (input.schema !== RELIVERSE_HOME_CONTRIBUTION_SCHEMA) {
    diagnostics.push(`Unsupported Home contribution schema: ${input.schema}.`);
  }
  if (!/^[a-z][a-z0-9-]*$/u.test(input.id)) {
    diagnostics.push(`Invalid Home contribution id: ${input.id}.`);
  }
  if (input.root === "" || input.root.startsWith("/") || input.root.includes("..")) {
    diagnostics.push(`Invalid Home contribution root: ${input.root}.`);
  }
  for (const [pathClass, patterns] of Object.entries({
    authored: input.authored,
    generated: input.generated,
    mutable: input.mutable,
    sensitive: input.sensitive,
  })) {
    for (const pattern of patterns) {
      if (
        pattern.length === 0 ||
        pattern.startsWith("/") ||
        pattern.includes("\\") ||
        pattern.split("/").includes("..")
      ) {
        diagnostics.push(`Invalid ${pathClass} pattern in ${input.id}: ${pattern}.`);
      }
    }
  }
  return Object.freeze(diagnostics);
}
