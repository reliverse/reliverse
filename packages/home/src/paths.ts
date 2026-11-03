import os from "node:os";
import path from "node:path";

import type { ReliverseHomePathSet, ReliversePrincipalId } from "./model";

export interface ResolveReliverseHomeRootOptions {
  readonly override?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly homedir?: string | undefined;
}

export function resolveReliverseHomeRoot(options: ResolveReliverseHomeRootOptions = {}): string {
  const env = options.env ?? process.env;
  const explicit = options.override?.trim() || env.RELIVERSE_HOME?.trim();
  if (explicit) return path.resolve(explicit);
  const home = options.homedir ?? env.HOME ?? env.USERPROFILE ?? os.homedir();
  if (!home)
    throw new Error("RELIVERSE_HOME_UNRESOLVED: Could not resolve the user home directory.");
  return path.resolve(home, ".reliverse");
}

export function createReliverseHomePathSet(
  root: string,
  principalId: ReliversePrincipalId,
): ReliverseHomePathSet {
  if (!isOpaquePrincipalDirectoryName(principalId))
    throw new Error("RELIVERSE_PRINCIPAL_ID_INVALID: Expected an opaque Principal ID.");
  const resolved = path.resolve(root);
  return Object.freeze({
    root: resolved,
    manifest: path.join(resolved, "home.json"),
    principals: path.join(resolved, "principals"),
    defaultPrincipal: path.join(resolved, "principals", principalId, "principal.json"),
    objects: path.join(resolved, "objects", "sha256"),
    store: path.join(resolved, "store"),
    secrets: path.join(resolved, "secrets"),
    rse: path.join(resolved, "rse"),
    rempts: path.join(resolved, "rempts"),
    dcs: path.join(resolved, "dcs"),
    gitignore: path.join(resolved, ".gitignore"),
    hooks: path.join(resolved, ".reliverse-hooks"),
    preCommitHook: path.join(resolved, ".reliverse-hooks", "pre-commit"),
  });
}

export function isOpaquePrincipalDirectoryName(value: string): boolean {
  return typeof value === "string" && /^prn_[0-9a-f]{32}$/u.test(value);
}
