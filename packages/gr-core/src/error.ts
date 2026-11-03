export type GrErrorCode =
  | "GR_ARTIFACT_EXISTS"
  | "GR_ARTIFACT_PATH_UNSAFE"
  | "GR_BACKEND_MISMATCH"
  | "GR_CAMPAIGN_CONFLICTED"
  | "GR_GIT_MUTATION_DENIED"
  | "GR_HOOKS_PATH_CONFLICT"
  | "GR_PRIVATE_PATH_FORBIDDEN"
  | "GR_REMOTE_BASE_DRIFT"
  | "GR_GIT_FAILED"
  | "GR_INDEX_CHANGED"
  | "GR_INVALID_ARTIFACT"
  | "GR_INVALID_RECEIPT"
  | "GR_NOT_AUTHORIZED"
  | "GR_NOT_REPOSITORY"
  | "GR_OUTPUT_LIMIT"
  | "GR_PATH_UNSAFE"
  | "GR_REPOSITORY_MISMATCH"
  | "GR_RESTORE_FAILED"
  | "GR_SANDBOX_CLEANUP_FAILED"
  | "GR_SANDBOX_OWNERSHIP"
  | "GR_SANDBOX_PATH_DENIED"
  | "GR_STALE_STATE"
  | "GR_UNSUPPORTED_STATE"
  | "GR_WORKSPACE_DIRTY";

export class GrError extends Error {
  readonly code: GrErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: GrErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = "GrError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
