import type { QualityCheckContext, QualityCheckHandlerResult } from "@reliverse/quality";

import { qualityResultFromPolicyReport } from "../shared/diagnostics";
import { repositoryRootFromContext } from "../shared/repository-target";
import { inspectTypeSupplyPolicy } from "./policy";

export async function checkRepositoryTypeSupply(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  return qualityResultFromPolicyReport(
    await inspectTypeSupplyPolicy(repositoryRootFromContext(context)),
  );
}
