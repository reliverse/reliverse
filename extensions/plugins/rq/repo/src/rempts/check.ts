import type { QualityCheckContext, QualityCheckHandlerResult } from "@reliverse/quality";

import { qualityResultFromPolicyReport } from "../shared/diagnostics";
import { repositoryRootFromContext } from "../shared/repository-target";
import { inspectRemptsPolicy } from "./policy";

export async function checkRepositoryRempts(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  return qualityResultFromPolicyReport(
    await inspectRemptsPolicy(repositoryRootFromContext(context)),
  );
}
