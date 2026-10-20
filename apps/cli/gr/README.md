# @reliverse/gr-cli

Rempts-based command-line projection of the `@reliverse/gr` Git-backed repository-state kernel.
The executable name is `gr`.

## Implemented operations

```txt
gr campaign plan                    gr.campaign.plan
gr commit / gr push                 host-bound repo.commit / repo.push (preview-first)
gr hooks install/status             GR Git mutation authority guards
gr status                           gr.workspace.inspect
gr version                          gr.repository.version.inspect
gr snapshot                         gr.workspace.snapshot
gr snapshot --accepted-head         accepted HEAD baseline
gr bundle                           gr.repository.bundle.create
gr diff                             gr.workspace.diff
gr patch                            gr.patch.create
gr patch finalize                   gr.patch.finalize
gr recovery                         gr.recovery.create
gr restore                          gr.restore
gr sandbox materialize              gr.workspace.sandbox.materialize
gr sandbox capture                  gr.workspace.sandbox.capture
gr sandbox cleanup                  gr.workspace.sandbox.cleanup
```

GR is evidence- and safety-oriented. Human `status` and `diff` output is bounded by
default; use `--all` for every path or `--json` for complete typed evidence. Most mutating commands remain preview-first and require explicit `--apply`. `gr bundle` is intentionally human-first: it executes by default, while `--dry-run` preserves a no-write preview. This keeps the common repository-transfer path to one command.

Canonical repository-local artifacts are written under `<repo>/.private/reliverse/gr/` by the
`@reliverse/gr` kernel. Snapshots and snapshot sandboxes currently retain ephemeral
Git objects only. Recovery capsules use the `patch-only` profile and do not claim
durable, conflict-free rollback after later overlapping edits.

Run `gr --help` or `gr <command> --help` for examples and command-specific safety
metadata.

## Preferred workflow

Agents should treat GR as the authority over Git mutation. Read-only Git inspection remains useful, but direct agent `git add`, `commit`, `push`, reset/rebase/merge/tag and related mutations are policy violations once GR authority is activated. `gr hooks install --apply` installs defense-in-depth Git guards; GR's mutation classifier covers non-hookable index/worktree operations for Rse/agent execution policy. Humans can still diagnose the Git backend explicitly when needed. Repository transitions should use `gr patch finalize`; the command owns private GR transition chronology and transition-derived artifact names, while repository/package semver remains release metadata outside GR ownership.

## Repository transfer

`gr bundle` creates a snapshot-bound streaming `tar.zst` transfer and defaults to the `offline` profile at the CLI surface. The ordinary human workflow is simply `gr bundle`. GR first reuses a verified User RPR common operator composition; when none is registered, it derives a conservative common-tooling plan from repository evidence such as `packageManager`, exact TypeScript/type-environment declarations, and repository-owned GR/Handoff sources. RPR then acquires or builds the exact closure, records provenance, creates the common lock/composition, and materializes it with network forbidden. No extra GR tooling manifest is required. `--tooling` remains an explicit expert/debug override.

Without `--out`, bundles go under `<repo>/.private/reliverse/gr/bundles/<short-timestamp>/`. Human filenames no longer carry the internal `.grb` marker; adjacent sidecars share one clean stem, for example `reliverse-stage046-000.tar.zst`, `reliverse-stage046-000.install.sh`, and `reliverse-stage046-000.receipt.json`. Bundle/snapshot hashes remain authoritative inside typed receipts and manifests.

GR Bundle Policy v0 may enable Global Rse Handoff-aware naming through `.config/gr.json` (or the user/private config layers): `{ "bundle": { "handoff": { "enabled": true, "global": true, "root": "../global-handoff" }, "output": { "timestampDirectory": "short", "naming": "handoff" } } }`. With timestamp directories disabled, GR allocates the first free `-000`..`-999` bundle revision. Active Work Turn IDs containing `wt*` are reflected in the human filename. `.private/**` at any depth is hard-excluded from source payloads.

## Campaigns

`gr campaign plan <paths...> --id <id> --base <revision>` creates a campaign-scoped plan. `--apply` persists it under `.private/reliverse/gr/campaigns/<id>/plan.json`. Dirt outside the campaign is explicitly allowed and reported separately; `.private/**` can never enter campaign scope.

Source-only planning is explicit for any campaign: add `--source-only --publication-policy <json-file>`. The policy file must contain `{ "mode": "source-only", "installability": "not-claimed", "exceptionRef": "<reviewed-policy-reference>" }`. These fields describe the plan; they are not owner approval, executable admission, or permission to commit or push. No campaign-specific exception is inferred by the CLI.

### Campaign commit specs

`gr campaign plan` accepts `--commits <json-file>` to bind an ordered semantic commit plan to the campaign artifact. The file must contain a JSON array of `{ id, title, paths, rationale? }` objects; every path must remain inside the campaign scope.

### Campaign execution

`gr campaign commit <plan.json> --id <commit-id>` is a non-authoritative preview; `--apply` refuses, like legacy campaign push. `gr commit` is the single commit mutation projection over a programmatically bound `repo.commit` Engine; `--interactive --apply` retains owner UID/TTY/context checks. No native binding is admitted by this source slice, and arbitrary free-form commit selection/planning is not implemented. The existing GR semantic Campaign step still owns scope/staged-tree/parent/readback checks behind the protected executor.

`gr push` previews one exact trusted-host Campaign binding. An owner launches execution with `gr push --interactive --apply` (or `bun gr push --interactive --apply` in this repository). Apply requires the bound owner UID, TTY, context and an independently admitted host composition; TTY/UID are launch constraints, not proof of human presence or release authority. The host freezes plan/RQ/executor/destination bindings and invokes the existing Cap/Gatehouse/GR path. Git publication uses strict fast-forward ancestry plus exact-old CAS and remote readback, with consumed/uncertain outcomes retained and no automatic retry. There are no caller-supplied plan/remote/ref/executor options, credential import or shell/source fallback.

Native source startup has no admitted host binding and previews `GR_OWNER_PUSH_HOST_NOT_ADMITTED`; apply fails closed. `runGrCli({ ownerPushHost, ownerCommitHost })` provides programmatic composition hooks for a separately trusted host, not admission or a grant issuer. Both owner hosts invoke the same Cap binding helper used by other admitted surfaces, with canonical `repo.*` contracts and explicit new CapRefs; existing `gr.campaign.*` Gate intent/receipt identities are retained. Fixtures prove the source projection, not live activation. The old `gr campaign push <plan.json>` remains a non-authoritative preview; its `--apply` refuses rather than bypassing the governed owner surface. Agents must not launch the owner's live push or substitute direct Git mutation.

Private GR chronology can be restored from an extracted repository bundle without copying `.private/**` into source payloads:

```bash
gr bundle restore-continuation ./extracted-bundle --root ./repository --apply
```

Use `--private-root <path>` when explicitly materializing into a relocated RVS Private root.

## Work Turns

Use `gr wt begin --id stage030-wt2 --handoff ../global-handoff --apply`, `gr wt status`, and `gr wt finish --apply`. Optional positional paths declare scope. The framework captures existing dirt and emits only the subsequent delta as forward/reverse patches. See `docs/specs/gr/work-turn-v0.md` for attribution and recovery limits.

If a human/editor changes staging during the same active WT (for example Zed `Stage All`), use `gr wt reconcile-index` to inspect, then explicitly acknowledge the exact preview pins with `--index-change-confirmed --actor <current-writer> --rationale <text> --work-turn-id <id> --turn-fingerprint <pin> --observed-fingerprint <pin> --apply`. This appends staging history without changing the original baseline, HEAD, index bytes or working files; later unacknowledged staging and out-of-scope source changes still fail closed. It does not finish/retire the WT or grant commit/push authority.

If an accepted descendant commit makes an active turn stale, use
`gr wt supersede --accepted-head --rationale <text> --apply`, then begin the
replacement turn with explicit `--accepted-head`. GR rejects staged or divergent
recovery state.

Host-integrated install is the default for bundled tooling: the installer imports the verified content-addressed toolchain into the destination User RPR and projects executables through `~/.reliverse/bin`. Pass `--isolated` to the generated installer to keep tooling under the restored repository instead.

### First-machine common tooling bootstrap

Common tooling is discovered rather than declared. The optional `bundle.tooling` section in normal GR config (`~/.reliverse/config/gr.json`, `.config/gr.json`, or private config) can set `mode`, `include`, `exclude`, and exact `versions` overrides. Auto inference is role-based: package-manager/runtime, TypeScript/type-environment, and repository operator signals may become common tooling; ordinary application dependencies do not become common merely because they appear in `package.json`.

For a GR installed through the registered RPR common toolchain, use `bun run build:update:common` from this package. Dler builds and receipts the authored GR; the common owner admits its exact bytes and updates the complete verified composition. On Linux the owner exchanges the materialized directories atomically, preserves the previous lock/composition and payload, and records an update audit. Interrupted transitions block GC; a failed post-cutover health check restores the verified baseline. Older common copies retire only after exact CAS recovery verification, while a path pin on `previous` refuses replacement. The public GR projection keeps its common-toolchain target.
