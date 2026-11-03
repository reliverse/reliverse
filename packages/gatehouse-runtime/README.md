# `@reliverse/gatehouse-runtime`

Durable local/self-hosted Gatehouse v0 state machine.

It persists immutable intents, append-only endorsements and decision receipts,
approval bundles, one-shot execution leases, revocations, lease consumption, and
execution receipts. Importing the package has no listener, notification, credential,
or policy side effects. Endorsements fail closed unless the embedding host supplies
an admitted verifier.

The runtime is side-effect free on import, file-backed when constructed, and fail-closed without an injected endorsement verifier. CLI and transport surfaces do not become authorities.
