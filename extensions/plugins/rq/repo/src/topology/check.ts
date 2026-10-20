import type { QualityCheckContext, QualityCheckHandlerResult } from "@reliverse/quality";

import { qualityResultFromPolicyReport } from "../shared/diagnostics";
import { repositoryRootFromContext } from "../shared/repository-target";
import { inspectTypecheckTopologyPolicy } from "./policy";

export async function checkRepositoryTopology(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  return qualityResultFromPolicyReport(
    await inspectTypecheckTopologyPolicy(repositoryRootFromContext(context)),
  );
}
