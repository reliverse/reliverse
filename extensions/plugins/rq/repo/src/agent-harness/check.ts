import type { QualityCheckContext, QualityCheckHandlerResult } from "@reliverse/quality";

import { qualityResultFromPolicyReport } from "../shared/diagnostics";
import { repositoryRootFromContext } from "../shared/repository-target";
import { inspectAgentHarnessPolicy } from "./policy";

export async function checkRepositoryAgentHarness(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  return qualityResultFromPolicyReport(
    await inspectAgentHarnessPolicy(repositoryRootFromContext(context)),
  );
}
