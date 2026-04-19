import type { BuildProvider } from "./provider/types";

export interface BuildProviderRegistry {
  readonly defaultProvider: string;
  readonly ids: readonly string[];
  get(id: string): BuildProvider | undefined;
}

export function createBuildProviderRegistry(options: {
  readonly defaultProvider?: string | undefined;
  readonly providers: readonly BuildProvider[];
}): BuildProviderRegistry {
  const defaultProvider = options.defaultProvider ?? options.providers[0]?.id;

  if (!defaultProvider) {
    throw new Error("Builder runtime requires at least one provider.");
  }

  const providers = new Map(options.providers.map((provider) => [provider.id, provider]));

  return {
    defaultProvider,
    get(id: string) {
      return providers.get(id);
    },
    ids: [...providers.keys()],
  };
}
