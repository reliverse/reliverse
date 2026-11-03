# `@reliverse/gatehouse-protocol`

Portable Gatehouse v0 contracts and deterministic intent/endorsement helpers.

The package has no listeners, policy store, credential access, or ambient runtime side effects.
It defines exact action identity, authority expressions, endorsement envelopes, approval bundles,
one-shot execution leases, revocation, consumption, execution, and inspection receipts.

The current canonical profile is deterministic JSON hashing for local executable conformance. It does not claim the future CBOR/COSE/P-256 interoperability profile.

Canonical inputs are JSON primitives, dense arrays, and plain objects (including
null-prototype objects). Class instances, non-finite numbers, cycles, sparse
arrays, and other non-JSON values are rejected. Undefined object properties are
omitted for optional-field compatibility; undefined array elements are rejected.
Own keys such as `__proto__` remain data. Shared, non-cyclic subtrees are allowed.
