# @reliverse/rvs-private

RVS-owned private-state topology for Reliverse workspaces, users, hosts and
operators.

`@reliverse/rvs-private` owns the meaning and resolution of private roots. It
does not own product config semantics, authorization, secret custody, or GR
transition semantics. DCS consumes resolved roots to locate config/schema
projections; Rse, GR, RPR and other products consume the same topology for
private state.

The default workspace private root is `<workspace>/.private`, but that pathname
is only a projection. `RELIVERSE_PRIVATE_ROOT` or an explicit binding may place
the same logical private namespace elsewhere. User state defaults below
`~/.reliverse`; operator state is separate and must be explicitly bound.

`private` does not mean `secret`. Portable-private, host-private, ephemeral and
secret classifications are distinct contracts; raw credentials are never made
portable merely because they live under a private root.

Product IDs passed to path helpers must be single path segments: an ASCII
letter or digit followed by ASCII letters, digits, dots, underscores or hyphens.
Workspace binding IDs use the same segment rules after trimming surrounding
whitespace; control characters are rejected. Paths and traversal segments are
not accepted as IDs.

## Durable workspace bindings

`@reliverse/rvs-private` can persist a workspace-to-private-root binding beneath
`<RELIVERSE_HOME>/rvs/private/workspaces/<opaque-workspace-id>/config.json`.
Workspace paths are discovery keys in a host-private index, never durable identity.
The opaque `wsp_*` ID is generated independently of the path.

The bootstrap documents use DCS v0 metadata, but RVS Private intentionally does
not depend on DCS: DCS already consumes RVS Private topology. This keeps the
first-party package graph acyclic while allowing DCS to validate/edit the same
control documents after bootstrap.
