# @reliverse/gr

Typed Git-backed repository-state kernel for Git Reliverse (GR).

The package provides:

```txt
gr.campaign.plan
gr.campaign.remote-base.verify
gr.hooks.install / gr.hooks.inspect
gr.workspace.inspect
gr.workspace.snapshot
gr.workspace.diff
gr.workspace.sandbox.materialize
gr.workspace.sandbox.capture
gr.workspace.sandbox.cleanup
gr.patch.create
gr.patch.finalize
gr.repository.version.inspect
gr.repository.bundle.create
gr.recovery.create
gr.restore
```

It owns workspace inspection, accepted-revision baselines, alternate-index snapshots, exact snapshot sandboxes,
exact snapshot diffs, snapshot-bound repository transfer bundles, forward/reverse Git patches, patch-only recovery capsules,
explicit restore, and immutable repository-local artifact materialization.

The package is the library-first kernel behind the standalone Rempts CLI at
`apps/cli/gr` / `@reliverse/gr-cli`. It does not provide its own executable or plugin.

GR uses:

```txt
~/.reliverse/gr/       machine-global state
<PRIVATE_ROOT>/reliverse/gr/       repository-local private artifacts (`<repo>/.private` by default)
```

Dirty workspaces are rejected by default. Explicit dirty capture is available for
controlled callers that establish and own the baseline; it is never inferred from
a successful inspection. Ignored paths remain excluded, and the real Git index is
verified byte-for-byte before and after snapshot and sandbox operations. Snapshot
sandboxes materialize the selected worktree tree without commits, refs, Git worktrees,
or writable hardlinks. Capture force-adds ignored outputs only into an alternate index
so undeclared private or ignored writes can be detected and rejected by the exact path
allowlist.

Current snapshots retain Git tree identities as ephemeral objects; the package
does not yet create a private ref or object pack and therefore makes no durable
object-retention claim. Current recovery capsules are patch-only. They are
portable delta evidence, not a claim of conflict-free rollback after arbitrary
later edits.

Typed repository artifacts and restore requests are intentionally bound to the
canonical worktree identity, including its root and Git administrative paths.
This prevents applying a typed capsule to a moved or different worktree by
accident. The independently materialized `changes.patch` and `reverse.patch` bytes
remain portable Git deltas when their declared preconditions hold.

Patch materialization writes a compact `manifest.json` that references
`changes.patch` and `reverse.patch` by filename and content fingerprint instead of
duplicating patch bytes. Recovery capsule manifests remain self-contained because
the patch-only capsule owns those bytes.

Temporary alternate-index cleanup is mandatory. Snapshot creation rejects cleanup
failure. Snapshot sandboxes use an ownership marker outside the writable workspace,
refuse markerless or linked cleanup targets, and return a fingerprinted cleanup receipt
with `removed`, `already-absent`, or `failed` status.

Forward restore now preflights the exact expected worktree tree, index tree, and HEAD
state before applying patch bytes. This is a stale-safe single-patch primitive, not a
claim of durable campaign journaling or multi-file transactionality.

## Repository workflow

Agents and humans should use GR instead of direct Git where GR is available. Direct Git remains an allowed fallback when GR cannot reasonably be bootstrapped from the provided environment. `gr patch finalize` allocates the next private GR transition ID from RVS Private state and materializes a transition-named portable patch. It does not mutate repository or package semver; release versions are outside GR ownership.

## Repository transfer

`gr.repository.bundle.create` materializes a snapshot-bound `tar.zst` repository transfer. Whole-repository and bounded-path source selection remain GR-owned. A verified RPR Toolchain Composition materialization may be attached by offline receipt. The GR CLI may ask RPR to ensure or bootstrap that composition from a zero-config repository tooling inference with optional GR-config overrides; the GR kernel still does not acquire packages or own RPR dependency semantics. `accepted-revision` snapshots let cumulative work-turn environments capture accepted `HEAD` without staging or stashing candidate edits.

## Repository transfer policy v0

`gr bundle` excludes `.private/**` and `.git/**` from repository source by default. Additional glob exclusions and cheap history projection are configured through `~/.reliverse/config/gr.json`, `.config/gr.json`, or `.private/reliverse/gr/config.json`. Derived history metadata is attached separately under `metadata/gr/**`; GR private caches/archives never recursively enter `source.tar`.

## Open-sourcing control plane v0

GR Campaigns are scoped publication/change boundaries, not aliases for a clean Git worktree. A campaign can be closed while unrelated VPS-only work remains dirty outside the campaign scope. Campaign plans bind an expected public base commit/tree, reject `.private/**`, fail on conflicts inside the selected scope, and declare remote-base drift as fail-closed. Commit-size budgets are advisory; semantic cohesion owns the boundary.

GR Hooks separate agent intent from the Git backend. `classifyGrGitInvocation()` treats direct `git add`, `commit`, `push`, reset/rebase/merge/tag/worktree mutations and related commands as GR-authority operations. `gr hooks install --apply` adds Git-native guards for hookable ref/commit/push/rebase surfaces. Git hooks are defense in depth: index/worktree operations such as `git add` must additionally be denied by the agent execution policy using the GR classifier.

`.private/**` is a hard public-surface exclusion for GR patch bytes and repository bundles. Private GR notes may be local inputs to later renderers, but they are not patch/bundle payloads.

GR private artifact/config paths resolve through the shared DCS root topology. `RELIVERSE_PRIVATE_ROOT` may relocate the private root for a workspace while preserving `<repo>/.private` as the zero-config default.

## Private continuation attachments

Repository bundles may carry GR transition chronology as a checksum-bound private continuation attachment at `continuation/gr-transition-state.json`. This attachment is outside `artifacts/repository/source.tar`; `.private/**` remains excluded from repository source payloads. Restoration verifies bundle metadata, attachment digest, and repository identity, then materializes the state through RVS Private topology. A newer local transition state is never rolled back by an imported bundle.
