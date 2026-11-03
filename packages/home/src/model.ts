export const RELIVERSE_HOME_SCHEMA = "reliverse.home.v0" as const;
export const RELIVERSE_PRINCIPAL_SCHEMA = "reliverse.principal.v0" as const;
export const RELIVERSE_HOME_CONTRIBUTION_SCHEMA = "reliverse.home-contribution.v0" as const;

export const RELIVERSE_PRINCIPAL_KINDS = [
  "human",
  "agent",
  "organization",
  "service",
  "device",
] as const;
export const RELIVERSE_HOME_PATH_CLASSES = [
  "authored",
  "generated",
  "mutable",
  "sensitive",
] as const;

export type ReliversePrincipalKind = (typeof RELIVERSE_PRINCIPAL_KINDS)[number];
export type ReliverseHomePathClass = (typeof RELIVERSE_HOME_PATH_CLASSES)[number];
export type ReliversePrincipalId = `prn_${string}`;
export type ReliverseHomeId = `home_${string}`;

export interface ReliversePrincipalAliasV0 {
  readonly namespace: string;
  readonly value: string;
  readonly verified: boolean;
}

export interface ReliversePrincipalV0 {
  readonly schema: typeof RELIVERSE_PRINCIPAL_SCHEMA;
  readonly id: ReliversePrincipalId;
  readonly principalKind: ReliversePrincipalKind;
  readonly handle: string;
  readonly displayName?: string | undefined;
  readonly status: "active" | "revoked";
  readonly createdAt: string;
  readonly revokedAt?: string | undefined;
  readonly revocationReason?: string | undefined;
  readonly origin: Readonly<{
    kind: "local";
    hostUser?: string | undefined;
  }>;
  readonly aliases: readonly ReliversePrincipalAliasV0[];
}

export interface ReliverseHomeManifestV0 {
  readonly schema: typeof RELIVERSE_HOME_SCHEMA;
  readonly id: ReliverseHomeId;
  readonly createdAt: string;
  readonly defaultPrincipalId: ReliversePrincipalId;
  readonly git: Readonly<{
    mode: "shared" | "split-agents" | "disabled";
    remote: "none";
  }>;
  readonly contributions: readonly string[];
}

export interface ReliverseHomeContributionV0 {
  readonly schema: typeof RELIVERSE_HOME_CONTRIBUTION_SCHEMA;
  readonly id: string;
  readonly root: string;
  readonly authored: readonly string[];
  readonly generated: readonly string[];
  readonly mutable: readonly string[];
  readonly sensitive: readonly string[];
}

export interface ReliverseHomePathSet {
  readonly root: string;
  readonly manifest: string;
  readonly principals: string;
  readonly defaultPrincipal: string;
  readonly objects: string;
  readonly store: string;
  readonly secrets: string;
  readonly rse: string;
  readonly rempts: string;
  readonly dcs: string;
  readonly gitignore: string;
  readonly hooks: string;
  readonly preCommitHook: string;
}

export interface ReliverseHomeInitPlan {
  readonly format: "reliverse.home-init-plan.v0";
  readonly root: string;
  readonly home: ReliverseHomeManifestV0;
  readonly principal: ReliversePrincipalV0;
  readonly directories: readonly string[];
  readonly writes: readonly Readonly<{
    path: string;
    content: string;
    mode: number;
  }>[];
  readonly existing: boolean;
}

export interface ReliverseHomeDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "error" | "warning";
  readonly path?: string | undefined;
  readonly remediation?: string | undefined;
}

export interface ReliverseHomeInspection {
  readonly format: "reliverse.home-inspection.v0";
  readonly root: string;
  readonly exists: boolean;
  readonly ok: boolean;
  readonly manifest?: ReliverseHomeManifestV0 | undefined;
  readonly principal?: ReliversePrincipalV0 | undefined;
  readonly paths: ReliverseHomePathSet;
  readonly diagnostics: readonly ReliverseHomeDiagnostic[];
  readonly git: Readonly<{
    initialized: boolean;
    remoteCount: number;
    hooksPath?: string | undefined;
  }>;
}
