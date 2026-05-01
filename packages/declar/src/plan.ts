import { discoverPackageEntrypoints } from "./package-exports";
import type {
  DeclarFastDeclarationFallback,
  DeclarFastDeclarationMode,
  DeclarFastDeclarationOption,
  DeclarPipelineOptions,
  DeclarPipelinePhase,
  DeclarPipelinePlan,
} from "./types";

function normalizeFastDeclarationMode(
  mode: DeclarFastDeclarationOption | undefined,
): DeclarFastDeclarationMode {
  if (mode === true) {
    return "auto";
  }

  return mode ?? false;
}

function normalizeFastDeclarationFallback(
  fallback: DeclarFastDeclarationFallback | undefined,
): DeclarFastDeclarationFallback {
  return fallback ?? "typescript";
}

export function createDeclarPipelinePlan(options: DeclarPipelineOptions): DeclarPipelinePlan {
  const discovery = discoverPackageEntrypoints(options.packageJson);
  const fastDeclarations = normalizeFastDeclarationMode(options.fastDeclarations);
  const fastDeclarationFallback = normalizeFastDeclarationFallback(options.fastDeclarationFallback);
  const rollup = options.rollup ?? false;
  const updatePackageJson = options.updatePackageJson ?? false;

  const phases: DeclarPipelinePhase[] = ["read-tsconfig", "discover-entrypoints"];

  if (fastDeclarations) {
    phases.push("fast-isolated-declaration-emit");
  }

  phases.push("typescript-declaration-emit", "validate-package-types");

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
    fastDeclarationFallback,
    fastDeclarations,
    outDir: options.outDir ?? "dist",
    packageDir: options.packageDir,
    phases,
    rollup,
    tsconfigPath: options.tsconfigPath ?? "tsconfig.json",
    updatePackageJson,
  };
}
