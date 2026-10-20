import { defineQualityContribution } from "@reliverse/quality/rempts";
import { REMPTS_PLUGIN_API_VERSION, definePlugin } from "@reliverse/rempts";

import { REPO_RQ_CONFIG_DEFAULTS, REPO_RQ_CONFIG_SCHEMA } from "./config";
import { repoQualitySuite } from "./suite";

export * from "./config";
export { inspectPublicSurfaceHygienePolicy } from "./public-surface-hygiene/policy";
export { REPO_PUBLIC_SURFACE_HYGIENE_RULE_IDS } from "./public-surface-hygiene/rules";
export { inspectRvsDomainPolicy } from "./rvs-domains/policy";
export { REPO_RVS_DOMAIN_RULE_IDS } from "./rvs-domains/rules";
export { repoQualitySuite } from "./suite";

export default definePlugin({
  apiVersion: REMPTS_PLUGIN_API_VERSION,
  name: "repo-rq-plugin",
  entry: import.meta.url,
  description: "Repository quality suites for Reliverse Quality.",
  capabilities: [
    "repository-quality",
    "complexity-review",
    "package-naming",
    "package-policy",
    "dependency-policy",
    "rvs-domain-policy",
    "rse-thin-host-policy",
    "boundary-policy",
    "typecheck-topology",
    "tsconfig-policy",
    "fixture-policy",
    "schema-lifecycle",
    "public-surface-hygiene",
    "specification-adoption",
  ],
  config: {
    namespace: "repo",
    namespaceDefaults: REPO_RQ_CONFIG_DEFAULTS as unknown as Record<string, unknown>,
    namespaceSchema: REPO_RQ_CONFIG_SCHEMA,
  },
  provides: [
    "repo",
    "repo.complexity",
    "repo.naming",
    "repo.packages",
    "repo.dependencies",
    "repo.rvs-domains",
    "repo.rse-thin-host",
    "repo.boundaries",
    "repo.topology",
    "repo.tsconfig",
    "repo.fixtures",
    "repo.schemas",
    "repo.public-surface-hygiene",
    "repo.specs",
  ],
  contributions: [defineQualityContribution(repoQualitySuite)],
});
