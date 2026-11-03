# @reliverse/rvs-user

Product-neutral identity bridge for RVS consumers.

Reliverse Home remains the canonical durable Principal record. RVS User binds a
human, Agent, service, or device Actor to that Principal with explicit provider,
proof, assurance, lifecycle, and revocation provenance. A binding is inspectable
identity evidence; it never grants a Cap or execution authority.

The package also defines transferable role records such as `My Rse`. `My Rse` is
one revocable relationship between a stable Principal and an ordinary eligible
Agent. First-party and external provenance use the same Agent identity and role
eligibility contract. Transfers preserve Principal and Agent IDs and do not carry
permissions, tools, secrets, or Gatehouse grants.

The delegation layer binds `actor` and `actingFor` through an inspectable,
expiring and revocable chain. Its typed authority envelope can only narrow
capabilities, resources, effects, placement, expiry, uses, cost and remaining
delegation depth. Authority still comes from referenced Cap grants or Gatehouse
leases; RVS User does not decide policy.

`resolveRvsUserDelegationExpiry` and `createRvsUserDelegationForDuration` support
positive integer `24h` / `2d` elapsed UTC windows bounded by every referenced
authority expiry. They do not sign, renew or grant authority. The source Rse CLI
can import an already owner-signed exact mandate with `--duration` instead of
`--expires-at`; the derived expiry must equal the signed expiry exactly.
Reusable approval of future effects remains a separate UF/Gatehouse policy and
trusted-signing boundary, not a duration flag.

Execution identity keeps Principal, Agent/Actor, WorkTurn, Run, Computer,
ExecutionContext, Gateway and placement as distinct references. One logical
WorkTurn/Run may rematerialize locally or remotely without changing who acts for
whom. A Gateway or connection reference contributes provenance only.
