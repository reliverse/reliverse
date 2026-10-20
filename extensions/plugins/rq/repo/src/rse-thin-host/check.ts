import type { QualityCheckContext, QualityCheckHandlerResult } from "@reliverse/quality";

import { qualityResultFromPolicyReport } from "../shared/diagnostics";
import { repositoryRootFromContext } from "../shared/repository-target";
import { inspectRseThinHostPolicy } from "./policy";

export async function checkRepositoryRseThinHost(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  return qualityResultFromPolicyReport(
    await inspectRseThinHostPolicy(repositoryRootFromContext(context)),
  );
}
