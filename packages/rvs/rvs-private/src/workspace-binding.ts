import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  rvsPrivateControlRoot,
  rvsPrivateWorkspaceBindingPath,
  resolveRvsPrivateRootTopology,
  type ResolveRvsPrivateRootTopologyOptions,
  type RvsPrivateRootTopologyV0,
} from "./topology";

export const RVS_PRIVATE_WORKSPACE_BINDING_SCHEMA = "rvs.private.workspace-binding.v0" as const;
export const RVS_PRIVATE_WORKSPACE_INDEX_SCHEMA = "rvs.private.workspace-index.v0" as const;
export const RVS_PRIVATE_DCS_CONTRACT_ID = "org.reliverse.rvs.private.workspace" as const;
export const RVS_PRIVATE_DCS_INDEX_CONTRACT_ID = "org.reliverse.rvs.private.workspace-index" as const;

export type RvsPrivateBindingAuthority = "user" | "operator";

export interface RvsPrivateDcsMetadataV0 {
  readonly id: string;
  readonly contractVersion: 0;
  readonly documentVersion: 0;
}

export interface RvsPrivateWorkspaceBindingV0 {
  readonly $dcs: RvsPrivateDcsMetadataV0;
  readonly schemaVersion: typeof RVS_PRIVATE_WORKSPACE_BINDING_SCHEMA;
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly privateRoot: string;
  readonly authority: RvsPrivateBindingAuthority;
}

export interface RvsPrivateWorkspaceIndexEntryV0 {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
}

export interface RvsPrivateWorkspaceIndexV0 {
  readonly $dcs: RvsPrivateDcsMetadataV0;
  readonly schemaVersion: typeof RVS_PRIVATE_WORKSPACE_INDEX_SCHEMA;
  readonly workspaces: readonly RvsPrivateWorkspaceIndexEntryV0[];
}

export interface DiscoverRvsPrivateWorkspaceBindingOptions
  extends ResolveRvsPrivateRootTopologyOptions {
  readonly authority?: RvsPrivateBindingAuthority | undefined;
  readonly create?: boolean | undefined;
}

export interface ResolvedRvsPrivateWorkspaceBindingV0 {
  readonly binding: RvsPrivateWorkspaceBindingV0;
  readonly bindingPath: string;
  readonly controlRoot: string;
  readonly indexPath: string;
  readonly topology: RvsPrivateRootTopologyV0;
  readonly created: boolean;
}

function assertWorkspaceId(value: string): string {
  const normalized = value.trim();
  if (!/^wsp_[a-z0-9]{24}$/.test(normalized)) {
    throw new Error("RVS_PRIVATE_WORKSPACE_ID_INVALID: workspaceId must use the opaque wsp_<24 lowercase base36 chars> form.");
  }
  return normalized;
}

function generateWorkspaceId(): string {
  // 16 random bytes encoded in base36-like lowercase hex is deliberately opaque and path-independent.
  return `wsp_${randomBytes(12).toString("hex")}`;
}

function controlHome(topology: RvsPrivateRootTopologyV0, authority: RvsPrivateBindingAuthority): string {
  if (authority === "operator") {
    if (!topology.operatorHome) {
      throw new Error(
        "RVS_PRIVATE_OPERATOR_HOME_MISSING: operator workspace binding requires operatorHome or RELIVERSE_OPERATOR_HOME.",
      );
    }
    return topology.operatorHome;
  }
  return topology.reliverseHome;
}

export function rvsPrivateWorkspaceIndexPath(
  topology: RvsPrivateRootTopologyV0,
  authority: RvsPrivateBindingAuthority = "user",
): string {
  return path.join(controlHome(topology, authority), "rvs", "private", "bindings", "workspaces.json");
}

export function rvsPrivateWorkspaceBindingPathForAuthority(
  topology: RvsPrivateRootTopologyV0,
  workspaceId: string,
  authority: RvsPrivateBindingAuthority = "user",
): string {
  const id = assertWorkspaceId(workspaceId);
  if (authority === "user") return rvsPrivateWorkspaceBindingPath(topology, id);
  return path.join(controlHome(topology, authority), "rvs", "private", "workspaces", id, "config.json");
}

export function rvsPrivateWorkspaceBindingSchemaPath(
  topology: RvsPrivateRootTopologyV0,
  authority: RvsPrivateBindingAuthority = "user",
): string {
  return path.join(controlHome(topology, authority), "rvs", "private", "schema.json");
}

export function createRvsPrivateWorkspaceBindingSchemaV0(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://schemas.reliverse.org/rvs/private/workspace-binding.v0.schema.json",
    type: "object",
    additionalProperties: false,
    required: ["$dcs", "schemaVersion", "workspaceId", "workspaceRoot", "privateRoot", "authority"],
    properties: {
      $dcs: {
        type: "object",
        additionalProperties: false,
        required: ["id", "contractVersion", "documentVersion"],
        properties: {
          id: { const: RVS_PRIVATE_DCS_CONTRACT_ID },
          contractVersion: { const: 0 },
          documentVersion: { const: 0 },
        },
      },
      schemaVersion: { const: RVS_PRIVATE_WORKSPACE_BINDING_SCHEMA },
      workspaceId: { type: "string", pattern: "^wsp_[a-z0-9]{24}$" },
      workspaceRoot: { type: "string", minLength: 1 },
      privateRoot: { type: "string", minLength: 1 },
      authority: { enum: ["user", "operator"] },
    },
  });
}

async function readJsonFile<T>(location: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(location, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeJsonAtomic(location: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(location), { recursive: true });
  const temporary = `${location}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, location);
}

function normalizeIndex(index: RvsPrivateWorkspaceIndexV0 | undefined): RvsPrivateWorkspaceIndexV0 {
  if (!index) {
    return {
      $dcs: { id: RVS_PRIVATE_DCS_INDEX_CONTRACT_ID, contractVersion: 0, documentVersion: 0 },
      schemaVersion: RVS_PRIVATE_WORKSPACE_INDEX_SCHEMA,
      workspaces: [],
    };
  }
  if (
    index.$dcs?.id !== RVS_PRIVATE_DCS_INDEX_CONTRACT_ID ||
    index.$dcs?.contractVersion !== 0 ||
    index.$dcs?.documentVersion !== 0 ||
    index.schemaVersion !== RVS_PRIVATE_WORKSPACE_INDEX_SCHEMA ||
    !Array.isArray(index.workspaces)
  ) {
    throw new Error("RVS_PRIVATE_WORKSPACE_INDEX_INVALID: workspace binding index is not a supported v0 DCS document.");
  }
  return index;
}

function validateBinding(binding: RvsPrivateWorkspaceBindingV0): RvsPrivateWorkspaceBindingV0 {
  assertWorkspaceId(binding.workspaceId);
  if (
    binding.$dcs?.id !== RVS_PRIVATE_DCS_CONTRACT_ID ||
    binding.$dcs?.contractVersion !== 0 ||
    binding.$dcs?.documentVersion !== 0 ||
    binding.schemaVersion !== RVS_PRIVATE_WORKSPACE_BINDING_SCHEMA ||
    (binding.authority !== "user" && binding.authority !== "operator")
  ) {
    throw new Error("RVS_PRIVATE_WORKSPACE_BINDING_INVALID: workspace binding is not a supported v0 DCS document.");
  }
  return binding;
}

export async function discoverRvsPrivateWorkspaceBinding(
  options: DiscoverRvsPrivateWorkspaceBindingOptions,
): Promise<ResolvedRvsPrivateWorkspaceBindingV0 | undefined> {
  const authority = options.authority ?? "user";
  const topology = resolveRvsPrivateRootTopology(options);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const home = controlHome(topology, authority);
  const controlRoot = path.join(home, "rvs", "private");
  const indexPath = rvsPrivateWorkspaceIndexPath(topology, authority);
  const index = normalizeIndex(await readJsonFile<RvsPrivateWorkspaceIndexV0>(indexPath));
  const entry = index.workspaces.find((item) => path.resolve(item.workspaceRoot) === workspaceRoot);

  if (entry) {
    const bindingPath = rvsPrivateWorkspaceBindingPathForAuthority(topology, entry.workspaceId, authority);
    const binding = await readJsonFile<RvsPrivateWorkspaceBindingV0>(bindingPath);
    if (!binding) {
      throw new Error(`RVS_PRIVATE_WORKSPACE_BINDING_MISSING: index points to missing binding ${bindingPath}.`);
    }
    const valid = validateBinding(binding);
    if (path.resolve(valid.workspaceRoot) !== workspaceRoot) {
      throw new Error("RVS_PRIVATE_WORKSPACE_BINDING_ROOT_MISMATCH: binding workspaceRoot differs from indexed workspace.");
    }
    return { binding: valid, bindingPath, controlRoot, indexPath, topology, created: false };
  }

  if (options.create !== true) return undefined;

  const workspaceId = generateWorkspaceId();
  const binding: RvsPrivateWorkspaceBindingV0 = {
    $dcs: { id: RVS_PRIVATE_DCS_CONTRACT_ID, contractVersion: 0, documentVersion: 0 },
    schemaVersion: RVS_PRIVATE_WORKSPACE_BINDING_SCHEMA,
    workspaceId,
    workspaceRoot,
    privateRoot: topology.privateRoot,
    authority,
  };
  const bindingPath = rvsPrivateWorkspaceBindingPathForAuthority(topology, workspaceId, authority);
  const nextIndex: RvsPrivateWorkspaceIndexV0 = {
    ...index,
    workspaces: [...index.workspaces, { workspaceId, workspaceRoot }].sort((a, b) =>
      a.workspaceRoot.localeCompare(b.workspaceRoot),
    ),
  };
  await writeJsonAtomic(rvsPrivateWorkspaceBindingSchemaPath(topology, authority), createRvsPrivateWorkspaceBindingSchemaV0());
  await writeJsonAtomic(bindingPath, binding);
  await writeJsonAtomic(indexPath, nextIndex);
  return { binding, bindingPath, controlRoot, indexPath, topology, created: true };
}

/** Read-only owner catalog for consumers that must exclude every registered logical private root. */
export async function inspectRvsPrivateWorkspaceBindings(
  options: DiscoverRvsPrivateWorkspaceBindingOptions,
): Promise<readonly RvsPrivateWorkspaceBindingV0[]> {
  const authority = options.authority ?? "user", topology = resolveRvsPrivateRootTopology(options);
  const index = normalizeIndex(await readJsonFile<RvsPrivateWorkspaceIndexV0>(rvsPrivateWorkspaceIndexPath(topology, authority)));
  if (index.workspaces.length > 4096) throw Error("RVS_PRIVATE_WORKSPACE_INDEX_BUDGET");
  const bindings: RvsPrivateWorkspaceBindingV0[] = [];
  for (const entry of index.workspaces) {
    const file = rvsPrivateWorkspaceBindingPathForAuthority(topology, entry.workspaceId, authority);
    const raw = await readJsonFile<RvsPrivateWorkspaceBindingV0>(file);
    if (!raw) throw Error("RVS_PRIVATE_WORKSPACE_BINDING_MISSING");
    const binding = validateBinding(raw);
    if (binding.workspaceId !== entry.workspaceId || path.resolve(binding.workspaceRoot) !== path.resolve(entry.workspaceRoot) || binding.authority !== authority || !path.isAbsolute(binding.privateRoot))
      throw Error("RVS_PRIVATE_WORKSPACE_BINDING_ROOT_MISMATCH");
    bindings.push(binding);
  }
  return bindings;
}

export async function resolveRvsPrivateWorkspaceTopology(
  options: DiscoverRvsPrivateWorkspaceBindingOptions,
): Promise<RvsPrivateRootTopologyV0> {
  if (options.privateRoot || options.env?.RELIVERSE_PRIVATE_ROOT || process.env.RELIVERSE_PRIVATE_ROOT) {
    return resolveRvsPrivateRootTopology(options);
  }
  const discovered = await discoverRvsPrivateWorkspaceBinding({ ...options, create: false });
  if (!discovered) return resolveRvsPrivateRootTopology(options);
  return resolveRvsPrivateRootTopology({ ...options, privateRoot: discovered.binding.privateRoot });
}


export interface BindRvsPrivateWorkspaceOptions extends DiscoverRvsPrivateWorkspaceBindingOptions {
  readonly privateRoot: string;
}

export interface UnbindRvsPrivateWorkspaceResultV0 {
  readonly schemaVersion: "rvs.private.workspace-unbind-result.v0";
  readonly authority: RvsPrivateBindingAuthority;
  readonly workspaceRoot: string;
  readonly workspaceId?: string | undefined;
  readonly bindingPath?: string | undefined;
  readonly removed: boolean;
}

export interface InspectRvsPrivateWorkspaceStateV0 {
  readonly schemaVersion: "rvs.private.workspace-state.v0";
  readonly authority: RvsPrivateBindingAuthority;
  readonly workspaceRoot: string;
  readonly effectivePrivateRoot: string;
  readonly privateRootSource: RvsPrivateRootTopologyV0["sources"]["privateRoot"] | "durable-binding";
  readonly binding?: RvsPrivateWorkspaceBindingV0 | undefined;
  readonly bindingPath?: string | undefined;
  readonly indexPath: string;
  readonly controlRoot: string;
}

export async function bindRvsPrivateWorkspace(
  options: BindRvsPrivateWorkspaceOptions,
): Promise<ResolvedRvsPrivateWorkspaceBindingV0> {
  const authority = options.authority ?? "user";
  const topology = resolveRvsPrivateRootTopology(options);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const home = controlHome(topology, authority);
  const controlRoot = path.join(home, "rvs", "private");
  const indexPath = rvsPrivateWorkspaceIndexPath(topology, authority);
  const index = normalizeIndex(await readJsonFile<RvsPrivateWorkspaceIndexV0>(indexPath));
  const current = index.workspaces.find((item) => path.resolve(item.workspaceRoot) === workspaceRoot);
  const workspaceId = current?.workspaceId ?? generateWorkspaceId();
  const bindingPath = rvsPrivateWorkspaceBindingPathForAuthority(topology, workspaceId, authority);
  const binding: RvsPrivateWorkspaceBindingV0 = {
    $dcs: { id: RVS_PRIVATE_DCS_CONTRACT_ID, contractVersion: 0, documentVersion: 0 },
    schemaVersion: RVS_PRIVATE_WORKSPACE_BINDING_SCHEMA,
    workspaceId,
    workspaceRoot,
    privateRoot: path.resolve(options.privateRoot),
    authority,
  };
  const workspaces = current
    ? index.workspaces.map((item) =>
        item.workspaceId === workspaceId ? { workspaceId, workspaceRoot } : item,
      )
    : [...index.workspaces, { workspaceId, workspaceRoot }];
  const nextIndex: RvsPrivateWorkspaceIndexV0 = {
    ...index,
    workspaces: [...workspaces].sort((a, b) => a.workspaceRoot.localeCompare(b.workspaceRoot)),
  };
  await writeJsonAtomic(
    rvsPrivateWorkspaceBindingSchemaPath(topology, authority),
    createRvsPrivateWorkspaceBindingSchemaV0(),
  );
  await writeJsonAtomic(bindingPath, binding);
  await writeJsonAtomic(indexPath, nextIndex);
  return { binding, bindingPath, controlRoot, indexPath, topology, created: !current };
}

export async function unbindRvsPrivateWorkspace(
  options: DiscoverRvsPrivateWorkspaceBindingOptions,
): Promise<UnbindRvsPrivateWorkspaceResultV0> {
  const authority = options.authority ?? "user";
  const topology = resolveRvsPrivateRootTopology(options);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const indexPath = rvsPrivateWorkspaceIndexPath(topology, authority);
  const index = normalizeIndex(await readJsonFile<RvsPrivateWorkspaceIndexV0>(indexPath));
  const current = index.workspaces.find((item) => path.resolve(item.workspaceRoot) === workspaceRoot);
  if (!current) {
    return {
      schemaVersion: "rvs.private.workspace-unbind-result.v0",
      authority,
      workspaceRoot,
      removed: false,
    };
  }
  const bindingPath = rvsPrivateWorkspaceBindingPathForAuthority(topology, current.workspaceId, authority);
  const nextIndex: RvsPrivateWorkspaceIndexV0 = {
    ...index,
    workspaces: index.workspaces.filter((item) => item.workspaceId !== current.workspaceId),
  };
  await writeJsonAtomic(indexPath, nextIndex);
  await rm(bindingPath, { force: true });
  return {
    schemaVersion: "rvs.private.workspace-unbind-result.v0",
    authority,
    workspaceRoot,
    workspaceId: current.workspaceId,
    bindingPath,
    removed: true,
  };
}

export async function inspectRvsPrivateWorkspaceState(
  options: DiscoverRvsPrivateWorkspaceBindingOptions,
): Promise<InspectRvsPrivateWorkspaceStateV0> {
  const authority = options.authority ?? "user";
  const bootstrapTopology = resolveRvsPrivateRootTopology(options);
  const discovered = await discoverRvsPrivateWorkspaceBinding({ ...options, authority, create: false });
  const hasBootstrapOverride = Boolean(
    options.privateRoot || options.env?.RELIVERSE_PRIVATE_ROOT || process.env.RELIVERSE_PRIVATE_ROOT,
  );
  const effective = await resolveRvsPrivateWorkspaceTopology({ ...options, authority, create: false });
  return {
    schemaVersion: "rvs.private.workspace-state.v0",
    authority,
    workspaceRoot: effective.workspaceRoot,
    effectivePrivateRoot: effective.privateRoot,
    privateRootSource:
      !hasBootstrapOverride && discovered ? "durable-binding" : bootstrapTopology.sources.privateRoot,
    ...(discovered ? { binding: discovered.binding, bindingPath: discovered.bindingPath } : {}),
    indexPath: rvsPrivateWorkspaceIndexPath(bootstrapTopology, authority),
    controlRoot: path.join(controlHome(bootstrapTopology, authority), "rvs", "private"),
  };
}
