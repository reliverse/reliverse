export { parseTargetsOption } from "../shared-targets";

export const DEFAULT_RSE_BUILD_TARGETS = [
  "plugins/pm",
  "plugins/dler",
  "apps/cli",
] as const;
