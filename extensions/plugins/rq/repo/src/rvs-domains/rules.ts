import { defineRepositoryRule } from "../shared/rules";

export const REPO_RVS_DOMAIN_RULE_IDS = Object.freeze({
  canonicalOwner: "repo.rvs-domains.canonical-owner",
  coreConcreteDependency: "repo.rvs-domains.core-concrete-dependency",
  retiredPackageConsumer: "repo.rvs-domains.retired-package-consumer",
} as const);

export const REPO_RVS_DOMAIN_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.rvs-domains",
    "canonical-owner",
    "Canonical RVS domain owner",
    "Materialized RVS domain identities have one canonical package path.",
    "Stable package paths keep domain ownership explicit during decomposition.",
    "Restore the expected package identity/path or update the reviewed domain map.",
  ),
  defineRepositoryRule(
    "repo.rvs-domains",
    "core-concrete-dependency",
    "Environment-agnostic RVS core",
    "RVS core has no concrete OS, vendor, runtime, product, or stack dependency.",
    "Concrete integrations point inward to generic RVS contracts; core never points back.",
    "Move the concrete integration behind an outward adapter or Connector boundary.",
  ),
  defineRepositoryRule(
    "repo.rvs-domains",
    "retired-package-consumer",
    "Retired RVS package consumer",
    "No manifest or source import consumes an identity retired by the Stage 030 disposition matrix.",
    "Unpublished first-party package moves converge directly instead of preserving shadow topology.",
    "Import the target owner or semantic subpath recorded in package-domain-disposition-v0.json.",
  ),
]);
