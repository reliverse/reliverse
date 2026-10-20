import path from "node:path";

import {
  rvsPrivateProductRoot,
  resolveRvsPrivateRootTopology,
  resolveRvsPrivateWorkspaceTopology,
  type DiscoverRvsPrivateWorkspaceBindingOptions,
} from "@reliverse/rvs-private";

export function resolveGrPrivateRoot(
  repositoryRoot: string,
  options: {
    readonly env?: NodeJS.ProcessEnv | undefined;
    readonly privateRoot?: string | undefined;
  } = {},
): string {
  const topology = resolveRvsPrivateRootTopology({
    workspaceRoot: repositoryRoot,
    ...(options.env ? { env: options.env } : {}),
    ...(options.privateRoot ? { privateRoot: options.privateRoot } : {}),
  });
  return rvsPrivateProductRoot(topology, "gr");
}

export function resolveGrPrivatePath(
  repositoryRoot: string,
  ...segments: readonly string[]
): string {
  return path.join(resolveGrPrivateRoot(repositoryRoot), ...segments);
}

export async function resolveGrDurablePrivateRoot(
  repositoryRoot: string,
  options: Omit<DiscoverRvsPrivateWorkspaceBindingOptions, "workspaceRoot"> = {},
): Promise<string> {
  const topology = await resolveRvsPrivateWorkspaceTopology({
    workspaceRoot: repositoryRoot,
    ...options,
  });
  return rvsPrivateProductRoot(topology, "gr");
}

export async function resolveGrDurablePrivatePath(
  repositoryRoot: string,
  segments: readonly string[],
  options: Omit<DiscoverRvsPrivateWorkspaceBindingOptions, "workspaceRoot"> = {},
): Promise<string> {
  return path.join(await resolveGrDurablePrivateRoot(repositoryRoot, options), ...segments);
}
