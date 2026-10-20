import { defineRepositoryRule } from "../shared/rules";

export const REPO_TOOL_BRIDGE_RULE_IDS = Object.freeze({
  structuredTransport: "repo.tool-bridges.structured-transport",
  runtimeIsolation: "repo.tool-bridges.runtime-isolation",
  productConfig: "repo.tool-bridges.product-config",
  artifactEntry: "repo.tool-bridges.artifact-entry",
} as const);

export const REPO_TOOL_BRIDGE_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.tool-bridges",
    "structured-transport",
    "Structured process transport",
    "The generic process bridge disables shell execution and sends structured JSON.",
    "Typed operation transport must not fall back to shell parsing.",
    "Use shell: false and serialize the request as JSON.",
  ),
  defineRepositoryRule(
    "repo.tool-bridges",
    "runtime-isolation",
    "Transitional proxy isolation",
    "Present transitional Rse proxies remain lightweight and do not spawn product CLIs.",
    "Until retirement, proxy packages must route typed transport without embedding heavy runtimes or shelling out.",
    "Remove heavy runtime dependencies/imports and direct process spawning.",
  ),
  defineRepositoryRule(
    "repo.tool-bridges",
    "product-config",
    "Tool product config ownership",
    "Rse config and schema do not own standalone product configuration.",
    "Generic operation access must not collapse product DCS ownership into the agent host.",
    "Remove Dler, Relda, Rewse, and OME product config from Rse documents.",
  ),
  defineRepositoryRule(
    "repo.tool-bridges",
    "artifact-entry",
    "Standalone tool artifact entry",
    "Present tool descriptors activate their structured bridge artifact.",
    "Managed tool activation targets the operation endpoint, not an interactive CLI.",
    "Set the descriptor entry to dist/bridge.js.",
  ),
]);
