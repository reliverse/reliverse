import {
  cloneJsonValue,
  freezeJsonValue,
  isJsonArray,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "./json";

/**
 * Canonical provider identifier. Providers are data identifiers, not package
 * specifiers, URLs, shell commands, or executable code.
 */
export const DCS_SECRET_PROVIDER_ID_PATTERN = "^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$" as const;
const providerIdExpression = new RegExp(DCS_SECRET_PROVIDER_ID_PATTERN);

/**
 * A portable reference to secret material stored outside the DCS document.
 * DCS documents MUST contain references, never raw secret material.
 */
export interface DcsSecretReferencePayload extends JsonObject {
  readonly key: string;
  readonly provider: string;
}

export interface DcsSecretReference extends JsonObject {
  readonly $secret: DcsSecretReferencePayload;
}

/** Safe transport-safe summary. It intentionally excludes the provider key. */
export interface DcsSecretReferenceSummary {
  readonly state: "reference";
  readonly provider: string;
}

/** A diagnostic-friendly result for strict secret-reference validation. */
export interface DcsSecretReferenceValidationIssue {
  readonly code: "DCS7001" | "DCS7002" | "DCS7003" | "DCS7004";
  readonly message: string;
  readonly path?: string;
}

/**
 * Creates an immutable canonical secret reference. Callers never put secret
 * bytes into this object; `key` identifies material held by a provider.
 */
export function createDcsSecretReference(provider: string, key: string): DcsSecretReference {
  const value: JsonObject = { $secret: { key, provider } };
  const issues = validateDcsSecretReference(value);
  if (issues.length > 0) {
    throw new TypeError(issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"));
  }
  return freezeJsonValue(cloneJsonValue(value)) as unknown as DcsSecretReference;
}

/**
 * Tests whether `value` is exactly a canonical DCS secret reference.
 * Unknown `$secret`-shaped data is deliberately not accepted as valid, but
 * output redaction still fails closed for it.
 */
export function isDcsSecretReference(value: JsonValue): value is DcsSecretReference {
  return validateDcsSecretReference(value).length === 0;
}

/**
 * Validates structure without echoing a secret key in any diagnostic.
 * `path` is optional so callers may attach a config JSON Pointer.
 */
export function validateDcsSecretReference(
  value: JsonValue,
  path = "",
): readonly DcsSecretReferenceValidationIssue[] {
  const issues: DcsSecretReferenceValidationIssue[] = [];
  if (!isJsonObject(value)) {
    return [
      {
        code: "DCS7001",
        message: "Secret reference must be an object containing only $secret.",
        ...(path === "" ? {} : { path }),
      },
    ];
  }

  const rootKeys = Object.keys(value);
  if (rootKeys.length !== 1 || rootKeys[0] !== "$secret") {
    issues.push({
      code: "DCS7001",
      message: "Secret reference must contain only the $secret property.",
      ...(path === "" ? {} : { path }),
    });
  }

  const secret = value.$secret;
  if (!isJsonObject(secret)) {
    issues.push({
      code: "DCS7002",
      message: "$secret must be an object with provider and key strings.",
      ...(path === "" ? {} : { path: `${path}/$secret` }),
    });
    return issues;
  }

  const secretKeys = Object.keys(secret);
  const hasOnlyExpectedKeys =
    secretKeys.every((entry) => entry === "provider" || entry === "key") && secretKeys.length === 2;
  if (!hasOnlyExpectedKeys) {
    issues.push({
      code: "DCS7002",
      message: "$secret must contain only provider and key properties.",
      ...(path === "" ? {} : { path: `${path}/$secret` }),
    });
  }

  if (typeof secret.provider !== "string" || !providerIdExpression.test(secret.provider)) {
    issues.push({
      code: "DCS7003",
      message: "Secret provider must be a lower-case data identifier, not a command or URL.",
      ...(path === "" ? {} : { path: `${path}/$secret/provider` }),
    });
  }

  if (
    typeof secret.key !== "string" ||
    secret.key.length === 0 ||
    secret.key.length > 512 ||
    secret.key.includes("\u0000")
  ) {
    issues.push({
      code: "DCS7004",
      message: "Secret key must be a non-empty provider-local identifier.",
      ...(path === "" ? {} : { path: `${path}/$secret/key` }),
    });
  }

  return issues;
}

/**
 * Returns only the non-sensitive provider selector. Provider keys are never
 * included in UI, CLI, diagnostics, conflict payloads, or generic exports.
 */
export function summarizeDcsSecretReference(
  value: JsonValue,
): DcsSecretReferenceSummary | undefined {
  if (!isDcsSecretReference(value)) {
    return undefined;
  }
  return Object.freeze({ state: "reference" as const, provider: value.$secret.provider });
}

/**
 * Redacts canonical and malformed `$secret` shapes recursively. This is
 * intentionally fail-closed: an extension value that merely resembles a
 * secret reference is hidden rather than accidentally exported.
 */
export function redactDcsSecretReferences(value: JsonValue): JsonValue {
  if (isPotentialDcsSecretReference(value)) {
    return "<redacted>";
  }
  if (isJsonArray(value)) {
    return value.map((entry) => redactDcsSecretReferences(entry));
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactDcsSecretReferences(entry)]),
    );
  }
  return value;
}

/** Detects a canonical or malformed secret-shaped object for fail-closed output. */
export function isPotentialDcsSecretReference(value: JsonValue): boolean {
  return isJsonObject(value) && Object.prototype.hasOwnProperty.call(value, "$secret");
}
