# `@reliverse/dcs-contract`

Portable DCS semantics live here. The package is public and intentionally free
of Bun, Node filesystem, frontend framework, and TypeScript-DSL requirements,
so Rempts and implementations in Rust, Go, Python, Java, or another host
language can consume the same Config Contract Bundle and resolution evidence.

## `0.1.0` delivered surface

- Config IR and versioned inspectable IR artifacts → deterministic Config Contract Bundle generation;
- contract, defaults, field metadata, schema, JSON Pointer, and canonical JSON utilities;
- portable JSON and JSONC document-envelope parsing and validation;
- fixed `user → workspace → local → invocation` resolution;
- `replace`, field-aware `deep`, `append`, `unique`, and identity-aware `keyed` collection merge;
- explicit reset semantics that restore contract defaults;
- sparse identity collection removals/reorders and collection-aware provenance;
- field-level provenance and machine-readable `explainConfigPath()`;
- strict canonical secret-reference validation, schema/default validation, and fail-closed redaction for product and opaque extension data;
- overlapping reset/set rejection that understands sparse `deep` object fields;
- portable deterministic projections: CCB, checksum, schema, defaults, editor descriptor, structured docs, and Markdown docs;
- non-semantic field presentation metadata for framework-neutral renderers;
- target-CCB declarative migration routes: `rename`, `move`, `delete`, `split`, and `merge`;
- local Extension Contracts, extension bundles, product descriptor requirements, known-schema validation, compatibility diagnostics, and opaque unknown namespaces;
- portable DCS lockfile validation, serialization, and frozen-resolve evidence envelopes;
- stability-sensitive JSON/output contracts documented for the 0.1.x line.

Secret provider execution belongs above this portable package. It validates references and redacts presentation values, but never reads an environment variable, file, keychain, or network endpoint.

JSON object fields and JSON Pointer traversal use own properties only. Keys
such as `__proto__`, `constructor`, and `prototype` remain ordinary data;
inherited properties are not configuration values or declared schema fields.

The resolver accepts already parsed documents. Filesystem discovery and atomic
writes belong in `@reliverse/dcs/node`; UI renderers belong above both.
