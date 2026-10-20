import path from "node:path";

import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { asRecord, asStringRecord } from "../shared/static-policy";
import { REPO_DOCS_RULE_IDS } from "./rules";

export const REQUIRED_DOCS_CATALOG = Object.freeze({
  "fumadocs-core": "^16.10.7",
  "fumadocs-mdx": "^15.0.13",
  "fumadocs-ui": "^16.10.7",
  next: "^16.2.10",
} as const);

const DOCS_DEPENDENCIES = new Set(["@fumadocs/ui", ...Object.keys(REQUIRED_DOCS_CATALOG)]);
const DOCS_MANIFEST = "apps/web/wiki/package.json";
const RETIRED_PROJECTION_TARGET = "apps/wiki/content/docs";
const COLLECTIONS = Object.freeze([
  { directory: "docs", routeBase: "/docs" },
  { directory: "blog", routeBase: "/blog" },
] as const);
const IGNORED_ROUTE_PREFIXES = ["/api/", "/og/", "/llms.mdx/"] as const;
const ABSOLUTE_LINK_PATTERN = /\]\((\/[^)\s]+)\)|\bhref\s*=\s*["'](\/[^"']+)["']/gu;

function normalizeRoute(value: string): string {
  const withoutFragment = value.split(/[?#]/u, 1)[0] ?? value;
  const withoutTrailingSlash = withoutFragment.replace(/\/+$/u, "");
  return withoutTrailingSlash || "/";
}

function routeFromFile(relativePath: string, routeBase: string): string {
  const withoutExtension = relativePath.replace(/\.(?:md|mdx)$/iu, "");
  const withoutIndex = withoutExtension.replace(/(?:^|\/)index$/iu, "");
  return normalizeRoute(`${routeBase}/${withoutIndex}`);
}

function dependencyEntries(manifest: {
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly devDependencies?: Readonly<Record<string, unknown>>;
  readonly peerDependencies?: Readonly<Record<string, unknown>>;
}): readonly [string, string][] {
  return [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].flatMap(
    (section) => Object.entries(asStringRecord(section)),
  );
}

export async function inspectDocsPolicy(repositoryRoot: string): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const inventory = new Set(index.inventory);
  const findings: RepositoryPolicyFinding[] = [];
  const rootCatalog = asStringRecord(asRecord(index.rootPackage.manifest.workspaces).catalog);
  const rootOverrides = asStringRecord(index.rootPackage.manifest.overrides);

  for (const [name, expected] of Object.entries(REQUIRED_DOCS_CATALOG)) {
    if (rootCatalog[name] !== expected) {
      findings.push({
        ruleId: REPO_DOCS_RULE_IDS.catalogVersion,
        path: "package.json",
        message: `package.json: workspaces.catalog.${name} must be ${expected}; received ${rootCatalog[name] ?? "missing"}`,
      });
    }
  }
  for (const name of DOCS_DEPENDENCIES) {
    if (rootOverrides[name] !== undefined) {
      findings.push({
        ruleId: REPO_DOCS_RULE_IDS.catalogVersion,
        path: "package.json",
        message: `package.json: overrides must not pin ${name}; use the workspace catalog`,
      });
    }
  }

  const docsPackage = index.packages.find((entry) => entry.manifestPath === DOCS_MANIFEST);
  const docsDependencies = asStringRecord(docsPackage?.manifest.dependencies);
  for (const name of Object.keys(REQUIRED_DOCS_CATALOG)) {
    if (docsDependencies[name] !== "catalog:") {
      findings.push({
        ruleId: REPO_DOCS_RULE_IDS.catalogConsumer,
        path: DOCS_MANIFEST,
        message: `${DOCS_MANIFEST}: dependencies.${name} must use catalog:`,
      });
    }
  }

  for (const owner of index.packages) {
    for (const [name, version] of dependencyEntries(owner.manifest)) {
      if (!DOCS_DEPENDENCIES.has(name)) continue;
      if (owner.manifestPath !== DOCS_MANIFEST || version !== "catalog:") {
        findings.push({
          ruleId: REPO_DOCS_RULE_IDS.dependencyOwner,
          path: owner.manifestPath,
          message: `${owner.manifestPath}: ${name}@${version} is owned by the wiki and must use catalog:`,
        });
      }
    }
  }

  const nextConfigPath = "apps/web/wiki/next.config.mjs";
  const nextConfig = inventory.has(nextConfigPath) ? await index.readText(nextConfigPath) : "";
  if (!nextConfig.includes('from "fumadocs-mdx/next"')) {
    findings.push({
      ruleId: REPO_DOCS_RULE_IDS.nextConfig,
      path: nextConfigPath,
      message: `${nextConfigPath}: ESM Fumadocs MDX integration is missing`,
    });
  }

  const rseConfigPath = ".config/rse.json";
  if (
    inventory.has(rseConfigPath) &&
    (await index.readText(rseConfigPath)).includes(RETIRED_PROJECTION_TARGET)
  ) {
    findings.push({
      ruleId: REPO_DOCS_RULE_IDS.projectionTarget,
      path: rseConfigPath,
      message: `${rseConfigPath}: references retired projection target ${RETIRED_PROJECTION_TARGET}`,
    });
  }

  for (const requiredPath of [
    "docs/specs/libs/README.md",
    "docs/specs/rse/implementation-map.md",
  ] as const) {
    if (!inventory.has(requiredPath)) {
      findings.push({
        ruleId: REPO_DOCS_RULE_IDS.specEntrypoint,
        path: requiredPath,
        message: `${requiredPath}: canonical spec entrypoint is missing`,
      });
    }
  }
  for (const retiredPath of ["docs/specs/libs/index.md", "docs/specs/rse/index.md"] as const) {
    if (inventory.has(retiredPath)) {
      findings.push({
        ruleId: REPO_DOCS_RULE_IDS.specEntrypoint,
        path: retiredPath,
        message: `${retiredPath}: retired spec index must not exist`,
      });
    }
  }

  const routes = new Set<string>(["/"]);
  const markdownFiles: string[] = [];
  const contentRoot = "apps/web/wiki/content";
  for (const collection of COLLECTIONS) {
    const prefix = `${contentRoot}/${collection.directory}/`;
    const files = index.inventory.filter(
      (file) => file.startsWith(prefix) && /\.(?:md|mdx)$/iu.test(file),
    );
    markdownFiles.push(...files);
    for (const file of files) {
      routes.add(
        routeFromFile(path.posix.relative(prefix.slice(0, -1), file), collection.routeBase),
      );
    }
  }

  for (const file of markdownFiles) {
    const source = await index.readText(file);
    ABSOLUTE_LINK_PATTERN.lastIndex = 0;
    for (const match of source.matchAll(ABSOLUTE_LINK_PATTERN)) {
      const route = normalizeRoute(match[1] ?? match[2] ?? "");
      if (IGNORED_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix)) || routes.has(route))
        continue;
      findings.push({
        ruleId: REPO_DOCS_RULE_IDS.wikiRoute,
        path: file,
        message: `${file}: absolute wiki route ${route} has no content target`,
      });
    }
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: {
      docsStackPackages: Object.keys(REQUIRED_DOCS_CATALOG).length,
      repositoryRoot: index.repoRoot,
      wikiRoutes: routes.size,
    },
  };
}
