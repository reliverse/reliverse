---
name: avoid-overengineering
description: >-
  Use when planning, implementing, debugging, simplifying, or reviewing software
  changes with a concrete overengineering risk or an explicit request to reduce
  complexity: unnecessary abstractions, speculative future-proofing, excessive
  tests or mocks, needless prerequisites, repeated validation or review cycles,
  redundant agent/tool work, or disproportionate maintenance cost. Prefer the
  smallest sufficient, readable solution, preserve required guarantees, and
  finish authorized work without needless checkpoints.
metadata:
  short-description: Avoid overengineering and unnecessary work
---

# Avoid Overengineering

**Do only necessary work. Finish all necessary work.**

## Challenge before material expansion

1. **Outcome:** What accepted, observable result must work?
2. **Ownership:** Which existing API, contract, or workflow already owns it?
3. **Necessity:** What fails if this addition is omitted or deferred?
4. **Alternative:** What is the simplest viable approach at the right ownership boundary?
5. **Cost:** Is the benefit worth the code, tests, time, tokens, resources, and maintenance?

Choose **implement, simplify, defer, or request an owner trade-off**. If there is no concrete improvement, leave the solution alone. Challenge when useful, not as a mandatory review ritual.

## Keep the solution proportionate

- Stay within the accepted task and relevant diff; follow local conventions. Avoid unrelated refactors, formatting churn, and unrequested features.
- Reuse owning APIs, contracts, and proven dependencies. Address root causes rather than layering workarounds; check an API's actual limitations before replacing it.
- Avoid speculative frameworks, adapters, compatibility layers, configuration, and defensive branches for states already excluded by trusted contracts.
- Prefer clear, cohesive code over fewer lines. Keep useful abstractions; extract shared logic when it represents the same responsibility, not merely similar syntax.
- Test meaningful behavior, boundaries, and failure modes. Avoid redundant mocks and implementation-mirroring tests; neither test count nor test-to-code ratio is a quality target.
- Use targeted checks and reuse valid evidence and context, including loaded skill instructions. Do not repeat unchanged tests, file reads, large logs, or receipts without a concrete reason.
- Batch related defects where safe; challenge repeated fix/review cycles and unnecessary release blockers.
- Avoid extra agents, overlapping reviews, and orchestration unless they provide distinct value or are required by policy.
- Prefer tested, human-usable workflows over fragile temp scripts, thin command wrappers, or manual JSON orchestration.
- Keep CLI output human-readable by default. Use `--json` or other structured output when an exact contract or reliable processing requires it, not merely because the caller is an agent.

## Finish authorized work

- Follow **inspect → implement → validate → continue** until the accepted goal is verified or genuinely blocked.
- Tests, builds, reports, and checkpoints are not stopping conditions while authorized critical-path work remains.
- Investigate the cause when fixes repeatedly fail; do not stack speculative patches. Repair recoverable blockers with the smallest supported change.
- Defer non-blocking improvements; challenge material scope expansion before proceeding.
- Complete safe preparation before requesting missing approval. After approval, resume from retained state and reuse valid evidence.
- Verify the actual acceptance criteria before claiming completion; report only what the evidence supports.
- At a genuine blocker, report the smallest required action and stop; do not repeatedly recheck unchanged conditions.

## Preserve boundaries

- Never weaken correctness, security, authorization, recovery, immutable history, or mandatory independent review to save effort.
- Preserve existing behavior, public contracts, error semantics, and side effects unless the accepted task explicitly changes them.
- Distinguish absent, completed, and uncertain effects; never unsafely replay uncertain operations.
- Respect repository-defined GR, RQ, approval, and owning-workflow boundaries where applicable. Do not create an Overkill Gate, daemon, or additional review loop.
- Stop for missing authority, approval, essential information, resources, or materially unauthorized effects.
- Never initiate persistent or cross-turn continuation without explicit authorization.

**Make the complexity decision, return to delivery, and stop only at verified completion or a real blocker.**
