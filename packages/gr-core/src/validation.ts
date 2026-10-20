import { fingerprintGrJson } from "./json";
import type { GrFailureEvidence, GrGitObjectReference, GrRepositoryIdentity } from "./model";

export function isGrRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactGrKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function isNonEmptyGrString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isGrRelativePathValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/u.test(value) &&
    !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

export function isGrGitObjectReference(
  value: unknown,
  expectedKind?: GrGitObjectReference["kind"],
): value is GrGitObjectReference {
  if (!isGrRecord(value) || !hasExactGrKeys(value, ["algorithm", "kind", "oid"])) return false;
  if (value.algorithm !== "sha1" && value.algorithm !== "sha256") return false;
  if (value.kind !== "blob" && value.kind !== "commit" && value.kind !== "tree") return false;
  if (expectedKind && value.kind !== expectedKind) return false;
  const expectedLength = value.algorithm === "sha1" ? 40 : 64;
  return (
    typeof value.oid === "string" &&
    value.oid.length === expectedLength &&
    /^[a-f0-9]+$/u.test(value.oid)
  );
}

export function isGrRepositoryIdentity(value: unknown): value is GrRepositoryIdentity {
  if (
    !isGrRecord(value) ||
    !hasExactGrKeys(value, [
      "backend",
      "root",
      "commonDirectory",
      "gitDirectory",
      "objectFormat",
      "fingerprint",
    ]) ||
    value.backend !== "git" ||
    !isNonEmptyGrString(value.root) ||
    !isNonEmptyGrString(value.commonDirectory) ||
    !isNonEmptyGrString(value.gitDirectory) ||
    (value.objectFormat !== "sha1" && value.objectFormat !== "sha256") ||
    typeof value.fingerprint !== "string"
  ) {
    return false;
  }
  const semantic = {
    backend: value.backend,
    root: value.root,
    commonDirectory: value.commonDirectory,
    gitDirectory: value.gitDirectory,
    objectFormat: value.objectFormat,
  };
  return value.fingerprint === fingerprintGrJson(semantic, "gr.repository-identity.v0");
}

export function isGrFailureEvidence(value: unknown): value is GrFailureEvidence {
  if (!isGrRecord(value)) return false;
  const keys = value.details === undefined ? ["code", "message"] : ["code", "message", "details"];
  return (
    hasExactGrKeys(value, keys) &&
    isNonEmptyGrString(value.code) &&
    isNonEmptyGrString(value.message)
  );
}
