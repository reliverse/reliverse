import { createBuildProviderRegistry } from "./provider-registry";
import type { BuildProvider, BuildReport, BuildTarget } from "./provider/types";

export interface BuildPlan {
  readonly provider?: string | undefined;
  readonly targets: readonly BuildTarget[];
}

export interface BuilderRuntime {
  readonly defaultProvider: string;
  run(plan: BuildPlan): Promise<BuildReport>;
}

export interface CreateBuilderRuntimeOptions {
  readonly defaultProvider?: string | undefined;
  readonly providers: readonly BuildProvider[];
}

export function createBuilderRuntime(
  options: CreateBuilderRuntimeOptions,
): BuilderRuntime {
  const registry = createBuildProviderRegistry(options);

  return {
    defaultProvider: registry.defaultProvider,
    async run(plan) {
      const providerId = plan.provider ?? registry.defaultProvider;
      const provider = registry.get(providerId);

      if (!provider) {
        throw new Error(`Unknown build provider "${providerId}".`);
      }

      const startedAt = performance.now();
      const results = [];

      for (const target of plan.targets) {
        const result = await provider.buildTarget(target);
        results.push(result);

        if (!result.ok) {
          break;
        }
      }

      return {
        ok: results.every((result) => result.ok),
        provider: providerId,
        targets: results,
        totalDurationMs: Math.round(performance.now() - startedAt),
      };
    },
  };
}
