import type { GrJsonValue } from "./json";

export const GR_WORKSPACE_INSPECTION_SCHEMA_VERSION = "gr.workspace-inspection.v0" as const;
export const GR_SNAPSHOT_SCHEMA_VERSION = "gr.snapshot.v0" as const;
export const GR_WORKSPACE_DIFF_SCHEMA_VERSION = "gr.workspace-diff.v0" as const;
export const GR_PATCH_SCHEMA_VERSION = "gr.patch.v0" as const;
export const GR_RECOVERY_CAPSULE_SCHEMA_VERSION = "gr.recovery-capsule.v0" as const;
export const GR_RESTORE_RECEIPT_SCHEMA_VERSION = "gr.restore-receipt.v0" as const;
export const GR_SNAPSHOT_SANDBOX_SCHEMA_VERSION = "gr.snapshot-sandbox.v0" as const;
export const GR_SANDBOX_CLEANUP_RECEIPT_SCHEMA_VERSION =
  "gr.snapshot-sandbox-cleanup-receipt.v0" as const;

export type GrOperationId =
  | "gr.campaign.plan"
  | "gr.campaign.commit"
  | "gr.campaign.push"
  | "gr.campaign.remote-base.verify"
  | "gr.hooks.install"
  | "gr.hooks.inspect"
  | "gr.workspace.inspect"
  | "gr.workspace.snapshot"
  | "gr.workspace.diff"
  | "gr.patch.create"
  | "gr.patch.finalize"
  | "gr.repository.version.inspect"
  | "gr.repository.bundle.create"
  | "gr.repository.bundle.continuation.restore"
  | "gr.recovery.create"
  | "gr.restore"
  | "gr.workspace.sandbox.materialize"
  | "gr.workspace.sandbox.capture"
  | "gr.workspace.sandbox.cleanup";

export type GrEffectKind =
  | "artifact.write"
  | "filesystem.read"
  | "filesystem.write"
  | "git.read"
  | "git.write"
  | "network.write";

export type GrFailureEvidence = {
  readonly code: string;
  readonly message: string;
  readonly details?: GrJsonValue | undefined;
};

export type GrGitObjectReference = {
  readonly algorithm: "sha1" | "sha256";
  readonly kind: "blob" | "commit" | "tree";
  readonly oid: string;
};

export type GrRepositoryIdentity = {
  readonly backend: "git";
  readonly root: string;
  readonly commonDirectory: string;
  readonly gitDirectory: string;
  readonly objectFormat: "sha1" | "sha256";
  readonly fingerprint: string;
};

export type GrHeadState = {
  readonly state: "attached" | "detached" | "unborn";
  readonly ref?: string | undefined;
  readonly commit?: GrGitObjectReference | undefined;
  readonly tree?: GrGitObjectReference | undefined;
};

export type GrWorkspaceEntry = {
  readonly path: string;
  readonly originalPath?: string | undefined;
  readonly kind: "conflicted" | "tracked" | "untracked";
  readonly indexStatus: string;
  readonly worktreeStatus: string;
};

export type GrWorkspaceInspection = {
  readonly schemaVersion: typeof GR_WORKSPACE_INSPECTION_SCHEMA_VERSION;
  readonly operation: "gr.workspace.inspect";
  readonly repository: GrRepositoryIdentity;
  readonly head: GrHeadState;
  readonly entries: readonly GrWorkspaceEntry[];
  readonly summary: {
    readonly conflicted: number;
    readonly staged: number;
    readonly tracked: number;
    readonly unstaged: number;
    readonly untracked: number;
    readonly dirty: boolean;
  };
  readonly statusFingerprint: string;
  readonly inspectionFingerprint: string;
};

export type GrSnapshotScope =
  | { readonly kind: "workspace" }
  | { readonly kind: "paths"; readonly paths: readonly string[] };

export type GrCoverageState = "denied" | "excluded" | "included" | "not-applicable" | "unsupported";

export type GrSnapshotCoverage = {
  readonly head: GrCoverageState;
  readonly staged: GrCoverageState;
  readonly unstaged: GrCoverageState;
  readonly untracked: GrCoverageState;
  readonly ignored: GrCoverageState;
  readonly binary: GrCoverageState;
  readonly modes: GrCoverageState;
  readonly symlinks: GrCoverageState;
  readonly deletions: GrCoverageState;
  readonly renamesAndCopies: GrCoverageState;
  readonly submodules: GrCoverageState;
};

export type GrSnapshotOrigin =
  | {
      readonly kind: "campaign-candidate";
      readonly campaignId: string;
      readonly campaignFingerprint: string;
      readonly tree: GrGitObjectReference;
    }
  | {
      readonly kind: "live-worktree";
    }
  | {
      readonly kind: "accepted-revision";
      readonly revision: string;
      readonly commit: GrGitObjectReference;
      readonly tree: GrGitObjectReference;
    }
  | {
      readonly kind: "snapshot-sandbox";
      readonly materializationId: string;
      readonly materializationFingerprint: string;
      readonly baselineSnapshotId: string;
      readonly baselineSnapshotFingerprint: string;
      readonly stateFingerprint: string;
    };

export type GrSnapshot = {
  readonly schemaVersion: typeof GR_SNAPSHOT_SCHEMA_VERSION;
  readonly operation: "gr.workspace.snapshot";
  readonly snapshotId: string;
  readonly snapshotFingerprint: string;
  readonly repository: GrRepositoryIdentity;
  readonly role: "baseline" | "checkpoint" | "explicit" | "result";
  readonly origin: GrSnapshotOrigin;
  readonly scope: GrSnapshotScope;
  readonly inspectionFingerprint: string;
  readonly statusFingerprint: string;
  readonly head: GrHeadState;
  readonly indexTree: GrGitObjectReference;
  readonly worktreeTree: GrGitObjectReference;
  readonly coverage: GrSnapshotCoverage;
  readonly retention: "ephemeral";
};

export type GrSnapshotRequest = {
  readonly root: string;
  readonly role: GrSnapshot["role"];
  readonly scope?: GrSnapshotScope | undefined;
  readonly dirtyPolicy?: "capture" | "reject" | undefined;
  readonly grantedEffects?: readonly GrEffectKind[] | undefined;
  readonly signal?: AbortSignal | undefined;
};

export type GrSnapshotSandbox = {
  readonly schemaVersion: typeof GR_SNAPSHOT_SANDBOX_SCHEMA_VERSION;
  readonly operation: "gr.workspace.sandbox.materialize";
  readonly materializationId: string;
  readonly materializationFingerprint: string;
  readonly repository: GrRepositoryIdentity;
  readonly baseline: {
    readonly id: string;
    readonly fingerprint: string;
    readonly indexTree: GrGitObjectReference;
    readonly worktreeTree: GrGitObjectReference;
  };
  readonly scope: { readonly kind: "workspace" };
  readonly strategy: "git-tree-alternate-index";
  readonly containerRoot: string;
  readonly workspaceRoot: string;
  readonly ownershipMarker: string;
  readonly retention: "ephemeral";
  readonly gitEffects: {
    readonly realIndex: "verified-unchanged";
    readonly refs: "not-created";
    readonly commits: "not-created";
    readonly objects: "borrowed-ephemeral";
  };
};

export type GrSnapshotSandboxMaterializeRequest = {
  readonly root: string;
  readonly baseline: GrSnapshot;
  readonly grantedEffects?: readonly GrEffectKind[] | undefined;
  readonly signal?: AbortSignal | undefined;
};

export type GrSnapshotSandboxCaptureRequest = {
  readonly root: string;
  readonly baseline: GrSnapshot;
  readonly sandbox: GrSnapshotSandbox;
  readonly allowedChangedPaths: readonly string[];
  /** Candidate verification only: exclude newly installed node_modules, never baseline source. */
  readonly excludeInstalledDependencies?: boolean;
  readonly grantedEffects?: readonly GrEffectKind[] | undefined;
  readonly signal?: AbortSignal | undefined;
};

export type GrSnapshotSandboxCleanupRequest = {
  readonly root: string;
  readonly sandbox: GrSnapshotSandbox;
  readonly grantedEffects?: readonly GrEffectKind[] | undefined;
};

export type GrSandboxCleanupReceipt = {
  readonly schemaVersion: typeof GR_SANDBOX_CLEANUP_RECEIPT_SCHEMA_VERSION;
  readonly operation: "gr.workspace.sandbox.cleanup";
  readonly materialization: { readonly id: string; readonly fingerprint: string };
  readonly status: "already-absent" | "failed" | "removed";
  readonly removedPath: string;
  readonly failure?: GrFailureEvidence | undefined;
  readonly receiptFingerprint: string;
};

export type GrChangeKind = "add" | "copy" | "delete" | "mode" | "modify" | "rename" | "symlink";

export type GrChangedFile = {
  readonly path: string;
  readonly originalPath?: string | undefined;
  readonly kind: GrChangeKind;
  readonly status: string;
  readonly before?: GrGitObjectReference | undefined;
  readonly after?: GrGitObjectReference | undefined;
  readonly beforeMode?: string | undefined;
  readonly afterMode?: string | undefined;
  readonly binary: boolean;
};

export type GrWorkspaceDiff = {
  readonly schemaVersion: typeof GR_WORKSPACE_DIFF_SCHEMA_VERSION;
  readonly operation: "gr.workspace.diff";
  readonly repository: GrRepositoryIdentity;
  readonly before: {
    readonly id: string;
    readonly fingerprint: string;
    readonly tree: GrGitObjectReference;
  };
  readonly result: {
    readonly id: string;
    readonly fingerprint: string;
    readonly tree: GrGitObjectReference;
  };
  readonly files: readonly GrChangedFile[];
  readonly policy: { readonly renameDetection: "find-renames"; readonly binary: "detect" };
  readonly diffFingerprint: string;
};

export type GrPatchContent = {
  readonly content: string;
  readonly fingerprint: string;
};

export type GrPatch = {
  readonly schemaVersion: typeof GR_PATCH_SCHEMA_VERSION;
  readonly operation: "gr.patch.create";
  readonly patchId: string;
  readonly patchFingerprint: string;
  readonly repository: GrRepositoryIdentity;
  readonly before: GrSnapshot;
  readonly result: GrSnapshot;
  readonly diff: GrWorkspaceDiff;
  readonly format: "git-diff-binary-full-index";
  readonly forward: GrPatchContent;
  readonly reverse: GrPatchContent;
};

export type GrRecoveryCapsule = {
  readonly schemaVersion: typeof GR_RECOVERY_CAPSULE_SCHEMA_VERSION;
  readonly operation: "gr.recovery.create";
  readonly capsuleId: string;
  readonly capsuleFingerprint: string;
  readonly profile: "patch-only";
  readonly repository: GrRepositoryIdentity;
  readonly patch: GrPatch;
  readonly coverage: {
    readonly repository: "patch";
    readonly privateArtifacts: "excluded";
    readonly preimages: "not-included";
    readonly retainedObjects: "not-included";
  };
  readonly limitations: readonly string[];
};

export type GrRestoreAuthorization = {
  readonly kind: "cli-flag" | "trusted-caller";
  readonly source: string;
};

export type GrRestoreOperationReceipt = {
  readonly path: string;
  readonly status: "not-run" | "restored" | "unknown";
  readonly failure?: GrFailureEvidence | undefined;
};

export type GrRestoreReceipt = {
  readonly schemaVersion: typeof GR_RESTORE_RECEIPT_SCHEMA_VERSION;
  readonly operation: "gr.restore";
  readonly receiptFingerprint: string;
  readonly runId: string;
  readonly createdAt: string;
  readonly direction: "forward" | "reverse";
  readonly repository: GrRepositoryIdentity;
  readonly capsule: { readonly id: string; readonly fingerprint: string };
  readonly authorization: GrRestoreAuthorization;
  readonly preflight: {
    readonly status: "failed" | "passed";
    readonly expectedTree: GrGitObjectReference;
    readonly actualTree?: GrGitObjectReference | undefined;
    readonly expectedIndexTree: GrGitObjectReference;
    readonly actualIndexTree?: GrGitObjectReference | undefined;
    readonly expectedHead: GrHeadState;
    readonly actualHead?: GrHeadState | undefined;
    readonly failure?: GrFailureEvidence | undefined;
  };
  readonly files: readonly GrRestoreOperationReceipt[];
  readonly beforeSnapshot?: { readonly id: string; readonly fingerprint: string } | undefined;
  readonly resultSnapshot?: { readonly id: string; readonly fingerprint: string } | undefined;
  readonly observedEffects: readonly GrEffectKind[];
  readonly status: "failed" | "succeeded";
  readonly failure?: GrFailureEvidence | undefined;
};

export type GrRestoreRequest = {
  readonly root: string;
  readonly capsule: GrRecoveryCapsule;
  readonly direction: "forward" | "reverse";
  readonly authorization?: GrRestoreAuthorization | undefined;
  readonly grantedEffects?: readonly GrEffectKind[] | undefined;
  readonly runId: string;
  readonly createdAt: string;
  readonly signal?: AbortSignal | undefined;
};

export type GrArtifactPaths = {
  readonly directory: string;
  readonly manifest: string;
  readonly files: Readonly<Record<string, string>>;
};
