import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { DcsSecretReference } from "@reliverse/dcs-contract";

import { createDcsSecretValue, type DcsSecretProvider } from "../secrets";

interface DcsAllowedSecretProviderOptions {
  /** Provider-local keys accepted by this host integration. Empty is deny-all. */
  readonly allowKeys: readonly string[];
  /** Defaults to the conventional provider id. */
  readonly id?: string;
}

export interface DcsEnvironmentSecretProviderOptions extends DcsAllowedSecretProviderOptions {
  /** Tests and server hosts may supply an explicit environment map. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export interface DcsFileSecretProviderOptions extends DcsAllowedSecretProviderOptions {
  /** Every file lookup is constrained below this trusted local root. */
  readonly rootDirectory: string;
  /** Remove one final LF or CRLF, matching conventional secret-file semantics. */
  readonly trimFinalNewline?: boolean;
}

export interface DcsKeychainSecretProviderOptions extends DcsAllowedSecretProviderOptions {
  /**
   * A host-supplied local keychain lookup. DCS intentionally does not guess a
   * platform command such as `security`, `secret-tool`, or PowerShell.
   */
  readonly lookup: (key: string) => string | undefined | Promise<string | undefined>;
}

/** Explicit allowlisted environment provider. It never enumerates `process.env`. */
export function createDcsEnvironmentSecretProvider(
  options: DcsEnvironmentSecretProviderOptions,
): DcsSecretProvider {
  const allowed = normalizeAllowedKeys(options.allowKeys);
  const environment = options.environment ?? process.env;
  return Object.freeze({
    id: options.id ?? "env",
    resolve(input: { readonly key: string; readonly reference: DcsSecretReference }) {
      if (!allowed.has(input.key)) {
        return { state: "denied" as const };
      }
      const value = environment[input.key];
      return value === undefined
        ? { state: "not-found" as const }
        : { state: "resolved" as const, value: createDcsSecretValue(value) };
    },
  });
}

/** Explicit allowlisted file provider constrained below a trusted local root. */
export function createDcsFileSecretProvider(
  options: DcsFileSecretProviderOptions,
): DcsSecretProvider {
  const allowed = normalizeAllowedKeys(options.allowKeys);
  const root = resolve(options.rootDirectory);
  return Object.freeze({
    id: options.id ?? "file",
    async resolve(input: { readonly key: string; readonly reference: DcsSecretReference }) {
      if (!allowed.has(input.key) || !isSafeRelativeKey(input.key)) {
        return { state: "denied" as const };
      }
      const location = resolve(root, input.key);
      const relativePath = relative(root, location);
      if (
        relativePath === "" ||
        relativePath === ".." ||
        relativePath.startsWith("..\\") ||
        relativePath.startsWith("../")
      ) {
        return { state: "denied" as const };
      }
      try {
        const text = await readFile(location, "utf8");
        const value = options.trimFinalNewline === false ? text : text.replace(/\r?\n$/, "");
        return { state: "resolved" as const, value: createDcsSecretValue(value) };
      } catch (error) {
        return isMissingFileError(error)
          ? { state: "not-found" as const }
          : { state: "unavailable" as const };
      }
    },
  });
}

/**
 * Explicit injected keychain provider. A platform host owns OS integration;
 * DCS owns allowlisting, result normalization, and non-leaking semantics.
 */
export function createDcsKeychainSecretProvider(
  options: DcsKeychainSecretProviderOptions,
): DcsSecretProvider {
  const allowed = normalizeAllowedKeys(options.allowKeys);
  return Object.freeze({
    id: options.id ?? "keychain",
    async resolve(input: { readonly key: string; readonly reference: DcsSecretReference }) {
      if (!allowed.has(input.key)) {
        return { state: "denied" as const };
      }
      try {
        const value = await options.lookup(input.key);
        return value === undefined
          ? { state: "not-found" as const }
          : { state: "resolved" as const, value: createDcsSecretValue(value) };
      } catch {
        return { state: "unavailable" as const };
      }
    },
  });
}

function normalizeAllowedKeys(keys: readonly string[]): ReadonlySet<string> {
  const result = new Set<string>();
  for (const key of keys) {
    if (typeof key !== "string" || key.length === 0 || key.includes("\u0000")) {
      throw new TypeError("DCS secret provider allowKeys must contain non-empty identifiers.");
    }
    result.add(key);
  }
  return result;
}

function isSafeRelativeKey(key: string): boolean {
  return (
    key.length > 0 &&
    !key.includes("\u0000") &&
    !isAbsolute(key) &&
    !key.startsWith("../") &&
    key !== ".."
  );
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
