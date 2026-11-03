import { homedir } from "node:os";
import path from "node:path";

export const RVS_PRIVATE_ROOT_TOPOLOGY_SCHEMA = "rvs.private.root-topology.v0" as const;

export interface ResolveRvsPrivateRootTopologyOptions {
  readonly workspaceRoot: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly privateRoot?: string | undefined;
  readonly reliverseHome?: string | undefined;
  readonly operatorHome?: string | undefined;
  readonly userHome?: string | undefined;
}

export interface RvsPrivateRootTopologyV0 {
  readonly schemaVersion: typeof RVS_PRIVATE_ROOT_TOPOLOGY_SCHEMA;
  readonly workspaceRoot: string;
  readonly privateRoot: string;
  readonly reliverseHome: string;
  readonly operatorHome?: string | undefined;
  readonly sources: Readonly<{
    privateRoot: "explicit" | "env" | "workspace-default";
    reliverseHome: "explicit" | "env" | "user-home-default";
    operatorHome?: "explicit" | "env" | undefined;
  }>;
}

export type RvsPrivateStateClass =
  | "portable-private"
  | "host-private"
  | "ephemeral-private"
  | "secret";

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : undefined;
}

export function resolveRvsPrivateRootTopology(
  options: ResolveRvsPrivateRootTopologyOptions,
): RvsPrivateRootTopologyV0 {
  const env = options.env ?? process.env;
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const explicitPrivateRoot = clean(options.privateRoot);
  const envPrivateRoot = clean(env.RELIVERSE_PRIVATE_ROOT);
  const explicitReliverseHome = clean(options.reliverseHome);
  const envReliverseHome = clean(env.RELIVERSE_HOME);
  const userHome = clean(options.userHome) ?? homedir();
  const explicitOperatorHome = clean(options.operatorHome);
  const envOperatorHome = clean(env.RELIVERSE_OPERATOR_HOME);

  const privateRoot = explicitPrivateRoot ?? envPrivateRoot ?? path.join(workspaceRoot, ".private");
  const reliverseHome =
    explicitReliverseHome ?? envReliverseHome ?? path.join(userHome, ".reliverse");
  const operatorHome = explicitOperatorHome ?? envOperatorHome;

  return Object.freeze({
    schemaVersion: RVS_PRIVATE_ROOT_TOPOLOGY_SCHEMA,
    workspaceRoot,
    privateRoot,
    reliverseHome,
    ...(operatorHome ? { operatorHome } : {}),
    sources: Object.freeze({
      privateRoot: explicitPrivateRoot ? "explicit" : envPrivateRoot ? "env" : "workspace-default",
      reliverseHome: explicitReliverseHome
        ? "explicit"
        : envReliverseHome
          ? "env"
          : "user-home-default",
      ...(operatorHome
        ? { operatorHome: explicitOperatorHome ? "explicit" : ("env" as const) }
        : {}),
    }),
  });
}

function isPathSegment(value: string): boolean {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9._-]*$/iu.test(value) &&
    value !== "." &&
    value !== ".."
  );
}

export function rvsPrivateProductRoot(
  topology: Pick<RvsPrivateRootTopologyV0, "privateRoot">,
  product: string,
): string {
  if (!isPathSegment(product))
    throw new Error("RVS_PRIVATE_PRODUCT_ID_INVALID: product must be one path segment.");
  return path.join(topology.privateRoot, "reliverse", product);
}

export function rvsPrivateUserProductRoot(
  topology: Pick<RvsPrivateRootTopologyV0, "reliverseHome">,
  product: string,
): string {
  if (!isPathSegment(product))
    throw new Error("RVS_PRIVATE_PRODUCT_ID_INVALID: product must be one path segment.");
  return path.join(topology.reliverseHome, product);
}

export function rvsPrivateControlRoot(
  topology: Pick<RvsPrivateRootTopologyV0, "reliverseHome">,
): string {
  return path.join(topology.reliverseHome, "rvs", "private");
}

export function rvsPrivateWorkspaceBindingsRoot(
  topology: Pick<RvsPrivateRootTopologyV0, "reliverseHome">,
): string {
  return path.join(rvsPrivateControlRoot(topology), "workspaces");
}

export function rvsPrivateWorkspaceBindingPath(
  topology: Pick<RvsPrivateRootTopologyV0, "reliverseHome">,
  workspaceId: string,
): string {
  const normalized = typeof workspaceId === "string" ? workspaceId.trim() : "";
  if (!isPathSegment(normalized) || /[\u0000-\u001f\u007f]/u.test(workspaceId)) {
    throw new Error(
      "RVS_PRIVATE_WORKSPACE_ID_INVALID: workspaceId must be one opaque path segment.",
    );
  }
  return path.join(rvsPrivateWorkspaceBindingsRoot(topology), normalized, "config.json");
}
