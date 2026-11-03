# `@reliverse/gatehouse-p256`

P-256 credential enrollment, signing, and verification for Gatehouse's current
local executable profile.

The Gateway-facing registry contains public keys only. Local authority private
keys are stored separately in mode-0600 files and are read only for an explicit
endorsement operation. The software profile never claims hardware binding,
user presence, or user verification.

## Exact external-agent delegation

`issueGatehouseExactDelegation` imports and verifies a **pre-signed** domain-separated
owner authorization for one
immutable Gate/intent, one separately enrolled agent credential/public-key digest,
finite lifetime, one attempt, and no redelegation. The mandate is not a bearer
owner endorsement: redemption also requires the agent's private key through
`createDelegatedGatehouseP256Endorsement`. Verification preserves the owner policy
slot and records the separate delegate credential; it never counts the delegate
as another independent root. Authority expansion/replacement is not admitted.
The intent digest pins all targets, parameters, preconditions and capability scope;
there is no blanket permission based on a command lacking `sudo`.

`rse gatehouse delegate issue|redeem|revoke --local` exposes the owning local-ledger
transport (preview by default, mutation requires `--apply`). Issue requires an
explicit `--authorization-file`, owner public credential, delegate credential,
decision reference, intent digest, expiry and output file. Despite its legacy
`issue` name, this operation cannot mint or broaden a mandate and has no owner
signer/custody port. Redeem needs only the mandate file and the delegate's
separate authority directory; it does not access owner private-key custody.
The owner signature must already have been produced across a trusted owner
boundary; chat/tool permission is not that proof. No isolated production owner
signer or canonical external-Agent enrollment bridge is established by this API.
Local same-UID software custody is not OS isolation against processes with that
UID: mode-0600 alone cannot stop an arbitrary same-UID agent accessing owner keys.
The fixture signer is test-only and is not a production delegation endpoint.

The new proof profile is intentionally incompatible with old HTTP verifiers.
Local admission uses the new verifier and canonical runtime before persisting
verified authority; it is not a failed-HTTP fallback or a direct ledger edit.
Installed HTTP support requires its own runtime update. Approval alone does not
start a Run or bypass execution authentication, spend limits or preconditions.

Revocation is Gate-scoped: `revokeGatehouseExactDelegation` revokes the exact Gate
and its unconsumed lease. Revoking a credential alone blocks new endorsements,
not already accepted ones; use exact Gate revocation to withdraw an admitted
mandate. Concurrent consumption/revocation follows the runtime's Gate lock;
completed effects remain historical. Mandate expiry cannot extend a task's
independent execution/provider policy window.
