import {
  DCS_SECRET_PROVIDER_ID_PATTERN,
  createDcsSecretReference,
  isDcsSecretReference,
  type DcsSecretReference,
  type JsonValue,
} from "@reliverse/dcs-contract";

export const DCS_SECRET_PROVIDER_REGISTRY_VERSION = "0.0.1" as const;
const providerIdExpression = new RegExp(DCS_SECRET_PROVIDER_ID_PATTERN);

/**
 * Opaque secret material that deliberately refuses accidental JSON output.
 * Only a trusted host should call `revealDcsSecretValue()` at the final point
 * where a downstream client actually needs the bytes.
 */
export class DcsSecretValue {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  public static from(value: string): DcsSecretValue {
    return new DcsSecretValue(value);
  }

  public toJSON(): never {
    throw new TypeError(
      "DCS secret material cannot be serialized. Use a redacted summary instead.",
    );
  }

  public toString(): string {
    return "[DCS secret]";
  }

  public valueOf(): never {
    throw new TypeError(
      "DCS secret material cannot be coerced. Use a trusted host reveal operation.",
    );
  }

  /** @internal Trusted host-only extraction primitive. */
  public revealForHost(): string {
    return this.#value;
  }
}

export function createDcsSecretValue(value: string): DcsSecretValue {
  if (typeof value !== "string") {
    throw new TypeError("DCS secret material must be a string.");
  }
  return DcsSecretValue.from(value);
}

/**
 * Deliberately explicit extraction boundary. Do not call this from UI, logs,
 * diagnostics, receipts, or generic config serialization.
 */
export function revealDcsSecretValue(value: DcsSecretValue): string {
  if (!(value instanceof DcsSecretValue)) {
    throw new TypeError("Expected DcsSecretValue.");
  }
  return value.revealForHost();
}

export type DcsSecretProviderResult =
  | { readonly state: "denied" }
  | { readonly state: "not-found" }
  | { readonly state: "resolved"; readonly value: DcsSecretValue }
  | { readonly state: "unavailable" };

/**
 * Providers are explicitly assembled by a trusted host. DCS never infers a
 * provider from the machine, spawns a command, reads env, or scans a keychain.
 */
export interface DcsSecretProvider {
  readonly id: string;
  resolve(input: {
    readonly key: string;
    readonly reference: DcsSecretReference;
  }): DcsSecretProviderResult | Promise<DcsSecretProviderResult>;
}

export interface DcsSecretProviderRegistry {
  readonly $dcs: {
    readonly format: "dcs-secret-provider-registry";
    readonly version: typeof DCS_SECRET_PROVIDER_REGISTRY_VERSION;
  };
  readonly providers: Readonly<Record<string, DcsSecretProvider>>;
}

export type DcsSecretResolution =
  | {
      readonly provider: string;
      readonly state:
        | "denied"
        | "not-found"
        | "provider-missing"
        | "unavailable"
        | "invalid-reference";
    }
  | { readonly provider: string; readonly state: "resolved"; readonly value: DcsSecretValue };

export interface DcsRedactedSecretResolution {
  readonly provider: string;
  readonly state: Exclude<DcsSecretResolution["state"], "resolved"> | "resolved";
}

export function createDcsSecretProviderRegistry(
  providers: readonly DcsSecretProvider[],
): DcsSecretProviderRegistry {
  const entries: Record<string, DcsSecretProvider> = {};
  for (const provider of providers) {
    if (typeof provider.id !== "string" || !providerIdExpression.test(provider.id)) {
      throw new TypeError("DCS secret provider id must be a lower-case data identifier.");
    }
    if (entries[provider.id] !== undefined) {
      throw new TypeError(
        `DCS secret provider ${JSON.stringify(provider.id)} was registered more than once.`,
      );
    }
    entries[provider.id] = provider;
  }
  return Object.freeze({
    $dcs: Object.freeze({
      format: "dcs-secret-provider-registry" as const,
      version: DCS_SECRET_PROVIDER_REGISTRY_VERSION,
    }),
    providers: Object.freeze(entries),
  });
}

/** Resolves exactly one reference and never materializes it into a config object. */
export async function resolveDcsSecretReference(input: {
  readonly reference: JsonValue;
  readonly registry: DcsSecretProviderRegistry;
}): Promise<DcsSecretResolution> {
  if (!isDcsSecretReference(input.reference)) {
    return Object.freeze({ provider: "<invalid>", state: "invalid-reference" as const });
  }
  const provider = input.registry.providers[input.reference.$secret.provider];
  if (provider === undefined) {
    return Object.freeze({
      provider: input.reference.$secret.provider,
      state: "provider-missing" as const,
    });
  }

  try {
    const result = await provider.resolve({
      key: input.reference.$secret.key,
      reference: input.reference,
    });
    if (result.state === "resolved") {
      if (!(result.value instanceof DcsSecretValue)) {
        return Object.freeze({ provider: provider.id, state: "unavailable" as const });
      }
      return Object.freeze({
        provider: provider.id,
        state: "resolved" as const,
        value: result.value,
      });
    }
    return Object.freeze({ provider: provider.id, state: result.state });
  } catch {
    // Provider errors are intentionally not surfaced; an exception can carry
    // a filesystem path, key, or a provider-specific secret-adjacent message.
    return Object.freeze({ provider: provider.id, state: "unavailable" as const });
  }
}

/** Safe result for CLI/UI/diagnostics. It never exposes a provider key or value. */
export function redactDcsSecretResolution(
  result: DcsSecretResolution,
): DcsRedactedSecretResolution {
  return Object.freeze({ provider: result.provider, state: result.state });
}

/** Convenience for authoring canonical portable references from TS. */
export function dcsSecret(provider: string, key: string): DcsSecretReference {
  return createDcsSecretReference(provider, key);
}
