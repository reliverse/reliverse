/**
 * Base error type that all errors extend. Provides a consistent shape for
 * error handling with `code`, optional `message`, and optional `cause`.
 *
 * Only enumerate error codes that you need to handle differently. If an error
 * only occurs in one module and doesn't need special handling, keep it local
 * to that module. Global errors here should be common across the application.
 *
 * Use `isError()` to check for a specific error code, or `isOneOf()` to check
 * for multiple codes. Both provide type narrowing for TypeScript.
 */
export interface BaseError<Code extends string = string> {
  code: Code;
  message?: string;
  cause?: unknown;
}

/**
 * Type-safe check for a specific error code. Narrows the type to `BaseError<T>`.
 */
export function isError<T extends string>(
  error: BaseError<string>,
  code: T,
): error is BaseError<T> {
  return error.code === code;
}

/**
 * Check if error matches any of the provided codes. Narrows the type to `BaseError<T>`.
 */
export function isOneOf<T extends string>(
  error: BaseError<string>,
  codes: readonly T[],
): error is BaseError<T> {
  return codes.includes(error.code as T);
}

/**
 * Common database operation errors. Use these for general CRUD failures
 * that can occur across any module.
 */
export const DatabaseErrorCode = {
  QUERY_FAILED: "QUERY_FAILED",
  INSERT_FAILED: "INSERT_FAILED",
  UPDATE_FAILED: "UPDATE_FAILED",
  DELETE_FAILED: "DELETE_FAILED",
  NOT_FOUND: "NOT_FOUND",
} as const;

export type DatabaseErrorCode = (typeof DatabaseErrorCode)[keyof typeof DatabaseErrorCode];

export type DatabaseError = BaseError<DatabaseErrorCode>;

export const dbError = {
  queryFailed: (cause?: unknown): DatabaseError => ({
    code: DatabaseErrorCode.QUERY_FAILED,
    message: "Database query failed",
    cause,
  }),

  insertFailed: (cause?: unknown): DatabaseError => ({
    code: DatabaseErrorCode.INSERT_FAILED,
    message: "Database insert failed",
    cause,
  }),

  updateFailed: (cause?: unknown): DatabaseError => ({
    code: DatabaseErrorCode.UPDATE_FAILED,
    message: "Database update failed",
    cause,
  }),

  deleteFailed: (cause?: unknown): DatabaseError => ({
    code: DatabaseErrorCode.DELETE_FAILED,
    message: "Database delete failed",
    cause,
  }),

  notFound: (id?: string): DatabaseError => ({
    code: DatabaseErrorCode.NOT_FOUND,
    message: id ? `Resource not found: ${id}` : "Resource not found",
  }),
};
