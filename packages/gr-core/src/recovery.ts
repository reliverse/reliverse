import { GrError } from "./error";
import { fingerprintGrJson, normalizeGrJson } from "./json";
import { GR_RECOVERY_CAPSULE_SCHEMA_VERSION, type GrPatch, type GrRecoveryCapsule } from "./model";
import { parseGrPatch } from "./patch";
import { isGrRepositoryIdentity } from "./validation";

const PATCH_ONLY_LIMITATIONS = Object.freeze([
  "Patch applicability may become stale after later overlapping workspace changes.",
  "The capsule does not contain private artifacts, retained Git objects, or file preimages beyond patch content.",
  "A successful patch creation is not evidence that restore completed.",
]);

export function createGrRecoveryCapsule(patchValue: GrPatch): GrRecoveryCapsule {
  const patch = parseGrPatch(patchValue);
  const semanticCapsule = {
    schemaVersion: GR_RECOVERY_CAPSULE_SCHEMA_VERSION,
    operation: "gr.recovery.create" as const,
    profile: "patch-only" as const,
    repository: patch.repository,
    patch,
    coverage: {
      repository: "patch" as const,
      privateArtifacts: "excluded" as const,
      preimages: "not-included" as const,
      retainedObjects: "not-included" as const,
    },
    limitations: PATCH_ONLY_LIMITATIONS,
  };
  const capsuleFingerprint = fingerprintGrJson(semanticCapsule, "gr.recovery-capsule.v0");
  return normalizeGrJson({
    ...semanticCapsule,
    capsuleId: `gr-recovery-${capsuleFingerprint.slice(0, 20)}`,
    capsuleFingerprint,
  }) as unknown as GrRecoveryCapsule;
}

export function parseGrRecoveryCapsule(value: unknown): GrRecoveryCapsule {
  const normalized = normalizeGrJson(value) as unknown as GrRecoveryCapsule;
  if (
    normalized.schemaVersion !== GR_RECOVERY_CAPSULE_SCHEMA_VERSION ||
    normalized.operation !== "gr.recovery.create" ||
    normalized.profile !== "patch-only" ||
    typeof normalized.capsuleId !== "string" ||
    typeof normalized.capsuleFingerprint !== "string" ||
    !isGrRepositoryIdentity(normalized.repository) ||
    !Array.isArray(normalized.limitations) ||
    normalized.limitations.some((limitation) => typeof limitation !== "string")
  ) {
    throw new GrError("GR_INVALID_ARTIFACT", "GR recovery capsule schema is invalid.");
  }
  const patch = parseGrPatch(normalized.patch);
  if (normalized.repository.fingerprint !== patch.repository.fingerprint) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR recovery capsule and patch repository identities do not match.",
    );
  }
  const { capsuleId, capsuleFingerprint, ...semanticCapsule } = normalized;
  const expected = fingerprintGrJson(semanticCapsule, "gr.recovery-capsule.v0");
  if (capsuleFingerprint !== expected || capsuleId !== `gr-recovery-${expected.slice(0, 20)}`) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR recovery capsule fingerprint or ID does not match its content.",
    );
  }
  return normalized;
}
