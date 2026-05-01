export class PackedPathError extends Error {}

export type NodeError = Error & {
  code?: string;
};

export function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error;
}