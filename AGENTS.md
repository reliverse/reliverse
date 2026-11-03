# Agent Instructions

## Execution and ownership

Finish authorized work at verified completion or a genuine blocker, not at an intermediate test, report, or checkpoint. Do not cross authority or approval boundaries to continue.

When available in the checkout, use the [avoid-overengineering skill](.agents/skills/avoid-overengineering/SKILL.md) for a concrete risk of excessive complexity, testing, ceremony, or cost. Otherwise apply the same principle directly: choose the smallest sufficient owning solution. Do not bootstrap missing agent tooling or turn this into a mandatory gate for routine changes.

Reuse skill instructions already available in the current thread. Reload only if they changed, were lost to compaction, or exact requirements need verification.

Keep production logic in its owning package or app and follow its contracts. Use `temp/` for disposable experiments and evidence, never as a production dependency.

Validate against the accepted outcome with relevant, focused checks; expand when required by risk or evidence, and reuse valid results instead of repeating unchanged work.

## Managed private state

Treat `.private/` as managed, potentially durable state containing credentials, receipts, and recovery history. Never assume it is disposable; use the owning authorized lifecycle for changes or cleanup.

## Public documentation and operational handoff

Public README/specs describe contributor-facing behavior, contracts, and supported workflows. Do not publish operator identities, machine-specific private paths, live incident histories, target hashes, Gate/journal IDs, or deployment checkpoints. Public docs may explain recovery contracts, not narrate incidents.

Keep operational continuation in the owning managed private state or private handoff store, not in contributor-facing files. Do not create a second canonical work ledger.

## Human UX and tool output

Human-facing CLIs default to readable output; `--json` is explicit opt-in when structured processing requires it. Request the smallest useful tool output without sacrificing correctness.

Do not disguise fragile ad-hoc scripts, `temp/` artifacts, or manual JSON orchestration as production Human UX. Prefer supported, tested owning APIs and workflows.
