import type { JsonValue, QualitySeverity } from "@reliverse/quality";

export type RepositoryPolicyFinding = {
  readonly ruleId: string;
  readonly message: string;
  readonly severity?: QualitySeverity | undefined;
  readonly path?: string | undefined;
  readonly range?:
    | {
        readonly start: { readonly line: number; readonly column: number };
        readonly end: { readonly line: number; readonly column: number };
      }
    | undefined;
  readonly data?: JsonValue | undefined;
  readonly evidence?:
    | readonly {
        readonly kind: string;
        readonly label: string;
        readonly path?: string | undefined;
        readonly value?: JsonValue | undefined;
      }[]
    | undefined;
};

export type RepositoryPolicyReport = {
  readonly findings: readonly RepositoryPolicyFinding[];
  readonly metadata?: JsonValue | undefined;
};

export function sortRepositoryPolicyFindings(
  findings: readonly RepositoryPolicyFinding[],
): readonly RepositoryPolicyFinding[] {
  return Object.freeze(
    [...findings].sort(
      (left, right) =>
        (left.path ?? "").localeCompare(right.path ?? "") ||
        (left.range?.start.line ?? 0) - (right.range?.start.line ?? 0) ||
        (left.range?.start.column ?? 0) - (right.range?.start.column ?? 0) ||
        left.ruleId.localeCompare(right.ruleId) ||
        left.message.localeCompare(right.message),
    ),
  );
}
