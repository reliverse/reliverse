import type { DeclarEntrypoint } from "./types";

export type DeclarDeclarationRollupRecommendation =
  | "use-current-text-bundler"
  | "keep-unbundled-declarations"
  | "delegate-semantic-rollup";

export type DeclarDeclarationRollupRisk =
  | "external-reexports"
  | "pattern-entrypoints"
  | "split-import-require-types"
  | "unknown-entrypoint-shape";

export interface DeclarDeclarationRollupStrategyOptions {
  readonly entrypoints: readonly DeclarEntrypoint[];
  readonly preferBundledDeclarations?: boolean | undefined;
}

export interface DeclarDeclarationRollupStrategyResult {
  readonly recommendation: DeclarDeclarationRollupRecommendation;
  readonly risks: readonly DeclarDeclarationRollupRisk[];
  readonly summary: string;
}

function hasPatternEntrypoints(entrypoints: readonly DeclarEntrypoint[]): boolean {
  return entrypoints.some((entrypoint) => entrypoint.kind === "pattern");
}

function hasSplitImportRequireTypes(entrypoints: readonly DeclarEntrypoint[]): boolean {
  return entrypoints.some(
    (entrypoint) =>
      entrypoint.importTypesPath !== undefined || entrypoint.requireTypesPath !== undefined,
  );
}

function hasConcreteTypes(entrypoints: readonly DeclarEntrypoint[]): boolean {
  return entrypoints.some((entrypoint) => entrypoint.typesConditions.length > 0);
}

export function assessDeclarDeclarationRollupStrategy(
  options: DeclarDeclarationRollupStrategyOptions,
): DeclarDeclarationRollupStrategyResult {
  const risks: DeclarDeclarationRollupRisk[] = [];

  if (!hasConcreteTypes(options.entrypoints)) {
    risks.push("unknown-entrypoint-shape");
  }

  if (hasPatternEntrypoints(options.entrypoints)) {
    risks.push("pattern-entrypoints");
  }

  if (hasSplitImportRequireTypes(options.entrypoints)) {
    risks.push("split-import-require-types");
  }

  if (!options.preferBundledDeclarations) {
    return {
      recommendation: "keep-unbundled-declarations",
      risks,
      summary:
        "Keep per-entrypoint declarations. Bundling is optional and should stay off unless the package needs a single-file declaration surface.",
    };
  }

  if (risks.length > 0) {
    return {
      recommendation: "delegate-semantic-rollup",
      risks,
      summary:
        "Use a proven semantic declaration rollup tool for this package shape. Declar's current bundler should remain conservative and opt-in.",
    };
  }

  return {
    recommendation: "use-current-text-bundler",
    risks,
    summary:
      "The current Declar text-level bundler is acceptable for this simple concrete declaration graph, with TypeScript validation after bundling.",
  };
}
