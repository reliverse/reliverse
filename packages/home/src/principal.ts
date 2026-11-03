import { randomUUID } from "node:crypto";

import {
  RELIVERSE_PRINCIPAL_KINDS,
  RELIVERSE_PRINCIPAL_SCHEMA,
  type ReliversePrincipalId,
  type ReliversePrincipalKind,
  type ReliversePrincipalV0,
} from "./model";

const PRINCIPAL_KIND_SET = new Set<string>(RELIVERSE_PRINCIPAL_KINDS);

export function normalizePrincipalHandle(value: string): string {
  const normalized = value.trim().normalize("NFKC").toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u.test(normalized)) {
    throw new Error(
      "RELIVERSE_PRINCIPAL_HANDLE_INVALID: Use 1-64 lowercase ASCII letters, digits, dots, underscores, or hyphens.",
    );
  }
  return normalized;
}

export function createReliversePrincipalId(): ReliversePrincipalId {
  return `prn_${randomUUID().replaceAll("-", "")}`;
}

export function createReliversePrincipal(input: {
  readonly handle: string;
  readonly principalKind?: ReliversePrincipalKind | undefined;
  readonly displayName?: string | undefined;
  readonly hostUser?: string | undefined;
  readonly id?: ReliversePrincipalId | undefined;
  readonly createdAt?: string | undefined;
}): ReliversePrincipalV0 {
  const principalKind = input.principalKind ?? "human";
  if (!PRINCIPAL_KIND_SET.has(principalKind)) {
    throw new Error(`RELIVERSE_PRINCIPAL_KIND_INVALID: ${principalKind}.`);
  }
  const handle = normalizePrincipalHandle(input.handle);
  const displayName = input.displayName?.trim();
  const hostUser = input.hostUser?.trim();
  return Object.freeze({
    schema: RELIVERSE_PRINCIPAL_SCHEMA,
    id: input.id ?? createReliversePrincipalId(),
    principalKind,
    status: "active",
    handle,
    ...(displayName ? { displayName } : {}),
    createdAt: input.createdAt ?? new Date().toISOString(),
    origin: Object.freeze({ kind: "local", ...(hostUser ? { hostUser } : {}) }),
    aliases: Object.freeze([
      Object.freeze({ namespace: "local-handle", value: handle, verified: true }),
    ]),
  });
}

export function validateReliversePrincipal(input: unknown): readonly string[] {
  const diagnostics: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return Object.freeze(["Principal must be an object."]);
  }
  const record = input as Record<string, unknown>;
  if (record.schema !== RELIVERSE_PRINCIPAL_SCHEMA)
    diagnostics.push("Unsupported principal schema.");
  if (typeof record.id !== "string" || !/^prn_[0-9a-f]{32}$/u.test(record.id)) {
    diagnostics.push("Principal id must be an opaque prn_ identifier.");
  }
  if (typeof record.principalKind !== "string" || !PRINCIPAL_KIND_SET.has(record.principalKind)) {
    diagnostics.push("Principal kind is invalid.");
  }
  if (record.status !== "active" && record.status !== "revoked") {
    diagnostics.push("Principal status is invalid.");
  }
  if (typeof record.handle !== "string") diagnostics.push("Principal handle is missing.");
  else {
    try {
      normalizePrincipalHandle(record.handle);
    } catch (error) {
      diagnostics.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (typeof record.createdAt !== "string" || Number.isNaN(Date.parse(record.createdAt))) {
    diagnostics.push("Principal createdAt must be an ISO timestamp.");
  }
  return Object.freeze(diagnostics);
}

export function revokeReliversePrincipal(
  principal: ReliversePrincipalV0,
  input: { readonly at?: string | undefined; readonly reason: string },
): ReliversePrincipalV0 {
  if (principal.status === "revoked") return principal;
  const revokedAt = input.at ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(revokedAt))) {
    throw new Error("RELIVERSE_PRINCIPAL_REVOCATION_TIME_INVALID");
  }
  return Object.freeze({
    ...principal,
    status: "revoked",
    revokedAt,
    revocationReason: input.reason.trim() || "revoked",
  });
}
