import path from "node:path";

import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { asRecord, asStringRecord } from "../shared/static-policy";
import { OFFICIAL_TYPE_SUPPLY } from "./official";
import { REPO_TYPE_SUPPLY_RULE_IDS } from "./rules";

export { OFFICIAL_TYPE_SUPPLY } from "./official";

const ALLOWED_DECLARATION_FILE_NAMES = new Set([
  "next-env.d.ts",
  "vite-env.d.ts",
  "bun-env.d.ts",
  "env.d.ts",
  "react-app-env.d.ts",
  "auto-imports.d.ts",
  "components.d.ts",
]);
const DECLARATION_FILE_PATTERN = /\.d\.(?:ts|cts|mts)$/iu;
const SHIM_NAME_PATTERN =
  /(?:^|\/)(?:.*(?:shim|shims|polyfill|polyfills|runtime)\.d\.(?:ts|cts|mts))$/iu;
const SHIM_CONTENT_PATTERN =
  /\bdeclare\s+(?:const|var|function|class|namespace|global)\b|\bdeclare\s+module\s+["'][^"']+["']\s*\{/u;
const HANDWRITTEN_NODE_SHIM = /\bdeclare\s+module\s+["']node:/u;

function isAssetOnlyDeclaration(relativePath: string, sourceText: string): boolean {
  const normalized = sourceText.trim();
  if (normalized.length === 0) return true;
  if (
    /^(?:\/\/[^\n]*\n|\s)*declare module ["'][^"']*(?:\.css|\.scss|\.sass|\.svg|\.png|\.jpg|\.jpeg|\.webp|\.gif|@fontsource[^"']*)["'];?\s*$/su.test(
      normalized,
    )
  ) {
    return true;
  }
  return /(?:^|\/)(?:style|styles|css|assets|fontsource)\.d\.ts$/u.test(relativePath);
}

export async function inspectTypeSupplyPolicy(
  repositoryRoot: string,
): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const findings: RepositoryPolicyFinding[] = [];
  const catalog = asStringRecord(asRecord(index.rootPackage.manifest.workspaces).catalog);
  const devDependencies = asStringRecord(index.rootPackage.manifest.devDependencies);

  for (const [name, expectedVersion] of Object.entries(OFFICIAL_TYPE_SUPPLY)) {
    if (catalog[name] !== expectedVersion) {
      findings.push({
        ruleId: REPO_TYPE_SUPPLY_RULE_IDS.catalogPin,
        path: "package.json",
        message: `package.json: workspaces.catalog.${name} must be pinned to ${expectedVersion}`,
      });
    }
    if (devDependencies[name] !== "catalog:") {
      findings.push({
        ruleId: REPO_TYPE_SUPPLY_RULE_IDS.rootConsumer,
        path: "package.json",
        message: `package.json: devDependencies.${name} must use catalog:`,
      });
    }
  }

  let inspectedFiles = 0;
  for (const file of index.sourceFiles) {
    if (file === "extensions/plugins/rq/repo/src/type-supply/policy.ts") continue;
    const source = await index.readText(file);
    inspectedFiles += 1;
    const declarationFile = DECLARATION_FILE_PATTERN.test(file);
    const customDeclaration =
      declarationFile &&
      !ALLOWED_DECLARATION_FILE_NAMES.has(path.posix.basename(file)) &&
      !isAssetOnlyDeclaration(file, source) &&
      (SHIM_NAME_PATTERN.test(file) || SHIM_CONTENT_PATTERN.test(source));
    if (HANDWRITTEN_NODE_SHIM.test(source) || customDeclaration) {
      findings.push({
        ruleId: REPO_TYPE_SUPPLY_RULE_IDS.customShim,
        path: file,
        message: `${file}: handwritten runtime/type shim is retired; use official type supply`,
      });
    }
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: {
      inspectedFiles,
      officialPackages: Object.keys(OFFICIAL_TYPE_SUPPLY).length,
      repositoryRoot: index.repoRoot,
    },
  };
}
