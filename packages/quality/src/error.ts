export type QualityErrorCode =
  | "RQ_APPLY_FAILED"
  | "RQ_APPLY_NOT_AUTHORIZED"
  | "RQ_APPLY_NOT_SUPPORTED"
  | "RQ_APPLY_RECEIPT_INVALID"
  | "RQ_CAPABILITY_COLLISION"
  | "RQ_CAPABILITY_NOT_FOUND"
  | "RQ_CHECK_EFFECT_NOT_READ_ONLY"
  | "RQ_CHECK_HANDLER_NOT_FOUND"
  | "RQ_CHECK_NOT_SUPPORTED"
  | "RQ_CONTRACT_INVALID"
  | "RQ_DIAGNOSTIC_COLLISION"
  | "RQ_DIAGNOSTIC_DUPLICATE"
  | "RQ_EFFECT_NOT_GRANTED"
  | "RQ_IDENTIFIER_NOT_FOUND"
  | "RQ_PLAN_EFFECT_NOT_PLAN_ONLY"
  | "RQ_PLAN_HANDLER_NOT_FOUND"
  | "RQ_PLAN_INVALID"
  | "RQ_PLAN_NOT_SUPPORTED"
  | "RQ_PLAN_BLOCKED"
  | "RQ_PLAN_INCOMPATIBLE"
  | "RQ_PLAN_PATH_UNSAFE"
  | "RQ_PLAN_STALE"
  | "RQ_PLAN_TARGET_MISMATCH"
  | "RQ_SUITE_COLLISION"
  | "RQ_PROVIDER_AMBIGUOUS"
  | "RQ_PROVIDER_NOT_FOUND"
  | "RQ_RULE_COLLISION"
  | "RQ_RULE_NOT_FOUND"
  | "RQ_VERIFICATION_FAILED"
  | "RQ_VERIFICATION_RECEIPT_INVALID";

export class QualityError extends Error {
  readonly code: QualityErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: QualityErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "QualityError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
