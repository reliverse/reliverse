import { discoverPackageEntrypoints } from "./package-exports";
import type { DeclarPipelineOptions, DeclarPipelinePhase, DeclarPipelinePlan } from "./types";

export function createDeclarPipelinePlan(options: DeclarPipelineOptions): DeclarPipelinePlan {
  const discovery = discoverPackageEntrypoints(options.packageJson);
  const rollup = options.rollup ?? false;
  const updatePackageJson = options.updatePackageJson ?? false;

  const phases: DeclarPipelinePhase[] = [
    "read-tsconfig",
    "discover-entrypoints",
    "typescript-declaration-emit",
    "validate-package-types",
  ];

  if (rollup) {
    phases.push("bundle-declarations");
  }

  if (updatePackageJson) {
    phases.push("wire-package-types");
  }

  phases.push("warn");

  return {
    declarationMap: options.declarationMap ?? false,
    diagnostics: discovery.diagnostics,
    entrypoints: discovery.entrypoints,
    outDir: options.outDir ?? "dist",
    packageDir: options.packageDir,
    phases,
    rollup,
    tsconfigPath: options.tsconfigPath ?? "tsconfig.json",
    updatePackageJson,
  };
}
