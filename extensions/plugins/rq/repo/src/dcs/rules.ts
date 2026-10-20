import { defineRepositoryRule } from "../shared/rules";

export const REPO_DCS_RULE_IDS = Object.freeze({
  ownerRegistration: "repo.dcs.owner-registration",
  hostProvider: "repo.dcs.host-provider",
  providerMount: "repo.dcs.provider-mount",
  trustedTypescript: "repo.dcs.trusted-typescript",
  productOwnership: "repo.dcs.product-ownership",
} as const);

export const REPO_DCS_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.dcs",
    "owner-registration",
    "DCS owner registration",
    "Standalone products declare their DCS ownership.",
    "Explicit ownership keeps product and integration configuration separate.",
    "Register the product with defineDcsOwner.",
  ),
  defineRepositoryRule(
    "repo.dcs",
    "host-provider",
    "Generalized DCS provider",
    "Standalone products create a generalized DCS host provider.",
    "Hosts should consume the shared DCS resolution lifecycle.",
    "Create the provider with createDcsHostConfigProvider.",
  ),
  defineRepositoryRule(
    "repo.dcs",
    "provider-mount",
    "DCS provider mount",
    "CLI hosts mount their product config provider.",
    "A declared owner is ineffective unless its host resolves the provider.",
    "Pass the product config provider to defineCLI.",
  ),
  defineRepositoryRule(
    "repo.dcs",
    "trusted-typescript",
    "Trusted TypeScript config",
    "Trusted TypeScript config discovery remains explicit and owner-scoped.",
    "Executable TypeScript configuration requires an explicit trust decision.",
    "Keep trusted: true with generalized DCS owner discovery.",
  ),
  defineRepositoryRule(
    "repo.dcs",
    "product-ownership",
    "Standalone product config ownership",
    "Rse config does not retain standalone product namespaces.",
    "Dler, Relda, Rewse, and OME own their product documents outside Rse plugin config.",
    "Move product configuration to its standalone DCS document.",
  ),
]);
