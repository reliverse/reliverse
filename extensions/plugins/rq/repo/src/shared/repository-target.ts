import path from "node:path";

import type { QualityCheckContext } from "@reliverse/quality";

export function repositoryRootFromContext(context: QualityCheckContext): string {
  return context.target.root ? path.resolve(context.target.root) : path.resolve(context.target.id);
}
