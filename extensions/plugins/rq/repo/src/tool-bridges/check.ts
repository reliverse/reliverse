import type { QualityCheckContext, QualityCheckHandlerResult } from "@reliverse/quality";

import { qualityResultFromPolicyReport } from "../shared/diagnostics";
import { repositoryRootFromContext } from "../shared/repository-target";
import { inspectToolBridgePolicy } from "./policy";

export async function checkRepositoryToolBridges(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  return qualityResultFromPolicyReport(
    await inspectToolBridgePolicy(repositoryRootFromContext(context)),
  );
}
