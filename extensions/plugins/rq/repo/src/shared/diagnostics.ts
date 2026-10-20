import {
  QualityError,
  type QualityCheckContext,
  type QualityCheckHandlerResult,
  type QualityDiagnosticInput,
} from "@reliverse/quality";
import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import type { RepositoryPolicyReport } from "./model";
import { repositoryRootFromContext } from "./repository-target";

/** Explicit publication scope is fingerprinted as check input; it is not whole-repository acceptance. */
export function withRepositoryPublicationScope(
  check: (context: QualityCheckContext) => Promise<QualityCheckHandlerResult>,
) {
  return async (context: QualityCheckContext): Promise<QualityCheckHandlerResult> => {
    const input = context.input;
    const scope =
      input && typeof input === "object" && !Array.isArray(input) && "publicationScope" in input
        ? input.publicationScope
        : undefined;
    if (scope === undefined) return check(context);
    const paths =
      scope && typeof scope === "object" && !Array.isArray(scope) && "paths" in scope
        ? scope.paths
        : undefined;
    if (
      !Array.isArray(paths) ||
      !paths.length ||
      paths.some(
        (p) =>
          typeof p !== "string" ||
          !/^[A-Za-z0-9_.\/-]+$/u.test(p) ||
          p.startsWith("/") ||
          p.split("/").some((part) => !part || part === "." || part === ".."),
      )
    )
      throw new QualityError(
        "RQ_VERIFICATION_FAILED",
        "Publication scope requires nonempty exact repository-relative paths.",
      );
    const inScope = (file: string) =>
      paths.some(
        (prefix) =>
          file === prefix || file.startsWith(`${prefix}/`) || prefix.startsWith(`${file}/`),
      );
    const index = await createRepositoryPolicyIndex(repositoryRootFromContext(context));
    const packages = new Set(
      index.workspacePackages.filter((p) => inScope(p.directory)).map((p) => p.manifest.name),
    );
    const result = await check(context);
    const roots = new Set(["package.json", "bun.lock", "LICENSE", "LICENSE.md", "LICENSE.txt"]);
    const diagnostics = result.diagnostics.filter((d) => {
      if (!d.path || roots.has(d.path) || inScope(d.path)) return true;
      const data = d.data;
      const related =
        data && typeof data === "object" && !Array.isArray(data) && "packages" in data
          ? data.packages
          : undefined;
      return (
        Array.isArray(related) &&
        related.some((name) => typeof name === "string" && packages.has(name))
      );
    });
    return {
      ...result,
      diagnostics,
      metadata: {
        underlying: result.metadata ?? null,
        publicationScope: {
          paths,
          omittedDiagnostics: result.diagnostics.length - diagnostics.length,
          acceptance: "selected-source-only",
        },
      },
    };
  };
}

export function qualityResultFromPolicyReport(
  report: RepositoryPolicyReport,
): QualityCheckHandlerResult {
  const diagnostics: readonly QualityDiagnosticInput[] = report.findings.map((finding) => ({
    ruleId: finding.ruleId,
    message: finding.message,
    ...(finding.severity === undefined ? {} : { severity: finding.severity }),
    ...(finding.path === undefined ? {} : { path: finding.path }),
    ...(finding.range === undefined ? {} : { range: finding.range }),
    ...(finding.data === undefined ? {} : { data: finding.data }),
    ...(finding.evidence === undefined ? {} : { evidence: finding.evidence }),
  }));
  return {
    diagnostics,
    ...(report.metadata === undefined ? {} : { metadata: report.metadata }),
  };
}
