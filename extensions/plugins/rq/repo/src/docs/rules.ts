import { defineRepositoryRule } from "../shared/rules";

export const REPO_DOCS_RULE_IDS = Object.freeze({
  catalogVersion: "repo.docs.catalog-version",
  catalogConsumer: "repo.docs.catalog-consumer",
  dependencyOwner: "repo.docs.dependency-owner",
  nextConfig: "repo.docs.next-config",
  projectionTarget: "repo.docs.projection-target",
  specEntrypoint: "repo.docs.spec-entrypoint",
  wikiRoute: "repo.docs.wiki-route",
} as const);

export const REPO_DOCS_RULES = Object.freeze([
  defineRepositoryRule(
    "repo.docs",
    "catalog-version",
    "Docs catalog versions",
    "The root catalog pins the reviewed Fumadocs and Next versions without overrides.",
    "One catalog controls the compatible documentation stack.",
    "Restore the reviewed catalog versions and remove overrides.",
  ),
  defineRepositoryRule(
    "repo.docs",
    "catalog-consumer",
    "Docs catalog consumption",
    "The wiki consumes its documentation stack through catalog references.",
    "Catalog consumption prevents package-local version drift.",
    "Use catalog: for the wiki docs dependencies.",
  ),
  defineRepositoryRule(
    "repo.docs",
    "dependency-owner",
    "Docs dependency ownership",
    "The wiki is the only direct consumer of the Fumadocs and Next stack.",
    "The docs stack has one application owner in this repository.",
    "Remove the dependency or move the consumer contract to the wiki.",
  ),
  defineRepositoryRule(
    "repo.docs",
    "next-config",
    "Wiki Next configuration",
    "The wiki retains an ESM Next config with Fumadocs MDX integration.",
    "Fumadocs projection depends on the ESM Next integration.",
    "Restore next.config.mjs and fumadocs-mdx/next.",
  ),
  defineRepositoryRule(
    "repo.docs",
    "projection-target",
    "Docs projection target",
    "Rse docs config does not reference the retired wiki target.",
    "Public documentation projects into apps/web/wiki/content/docs.",
    "Replace the retired apps/wiki target with the canonical target.",
  ),
  defineRepositoryRule(
    "repo.docs",
    "spec-entrypoint",
    "Canonical spec entrypoint",
    "Specification families use their current README or implementation-map entrypoints.",
    "Stable entrypoint ownership avoids duplicate and retired indexes.",
    "Restore canonical entrypoints and remove retired index files.",
  ),
  defineRepositoryRule(
    "repo.docs",
    "wiki-route",
    "Resolvable wiki route",
    "Absolute links in wiki content resolve to generated routes.",
    "Broken internal routes produce unusable public documentation.",
    "Correct the route or add the target content page.",
  ),
]);
