/**
 * @deprecated Root/private topology is owned by @reliverse/rvs-private.
 * These aliases remain temporarily for source compatibility while DCS consumers
 * migrate to the RVS Private Framework directly.
 */
export {
  RVS_PRIVATE_ROOT_TOPOLOGY_SCHEMA as DCS_ROOT_TOPOLOGY_SCHEMA,
  rvsPrivateProductRoot as dcsPrivateProductRoot,
  rvsPrivateUserProductRoot as dcsUserProductRoot,
  resolveRvsPrivateRootTopology as resolveDcsRootTopology,
  type ResolveRvsPrivateRootTopologyOptions as ResolveDcsRootTopologyOptions,
  type RvsPrivateRootTopologyV0 as DcsRootTopologyV0,
} from "@reliverse/rvs-private";
