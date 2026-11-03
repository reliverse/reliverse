# `@reliverse/dcs`

The package is published as the high-level DCS SDK. Its root export stays browser-safe; filesystem and host adapters remain under explicit `./node` and `./bun` subpaths.

`@reliverse/dcs` is the high-level TypeScript SDK for Define Config
Standard. It owns developer ergonomics and framework-neutral document editing
vocabulary, not portable DCS semantics: those remain in
`@reliverse/dcs-contract`.

## Imports

```ts
import { c, defineConfig, type DcsDocumentPatch } from "@reliverse/dcs";
import { resolveConfig, mutateConfigDocument } from "@reliverse/dcs/node";
```

The root package is browser-safe. It contains no filesystem, `process`, watcher,
HTTP-server, DOM, React, or Bun-specific runtime import.

## `0.1.0` delivered surface

### `@reliverse/dcs`

- `c.*` field DSL and `defineConfig()`;
- Config IR → deterministic portable CCB;
- JSON and JSONC document parsing and validation re-exports;
- versioned `definition.toIrArtifact()` / `toIrJson()` compiler artifacts;
- `DcsDocumentPatch` and `set` / `unset` / `reset` / legacy positional `move` plus identity `remove` / `move-by-id` operations;
- `DcsEditorSession`, browser-safe views with redacted host locations and patch summaries, rebase/conflict types, and invalidation events;
- `DcsEditorDocument` with `documentRevision`, `semanticRevision`, and
  `effectiveRevision` support;
- local Extension Contract registry types plus `DcsEditorExtension` entries with
  known/unknown status, descriptor presentation, schema, diagnostics, and fail-closed secret redaction;
- explicit browser-safe secret provider registry, opaque `DcsSecretValue`, canonical references, and redacted resolution summaries.

### `@reliverse/dcs/node`

- Linux XDG, macOS Application Support, Windows AppData, workspace, and local
  JSON and JSONC discovery;
- `resolveConfig()`, `validateConfig()`, `locateConfig()`, and `explainConfig()`;
- `writeDcsConfigLockfile()`, `verifyDcsConfigLockfile()`, `diffDcsConfigLockfile()`, and `assertDcsFrozenResolve()` for frozen resolved config evidence;
- `readConfigDocumentForEdit()`;
- `initializeConfigDocument()`;
- `mutateConfigDocument()` with expected document revision checks and atomic JSON or
  lossless JSONC writes;
- `DcsConfigWriteConflictError` and `DcsConfigDocumentFormatConflictError` for
  safe concurrent-editor handling;
- `openDcsEditorSession()` and `commitDcsEditorSession()` for rebase-or-conflict
  server-host commits;
- `planDcsConfigMigration()`, `applyDcsConfigMigration()`, and
  `restoreDcsConfigMigration()` for declarative lifecycle operations;
- `loadDcsExtensionRegistry()` for explicit bundle paths, workspace
  `.dcs/extensions`, and explicit package roots, without network/package execution;
- explicitly allowlisted `env`, root-contained `file`, and injected `keychain` secret-provider adapters. These never leak through the browser-safe root export.

### `@reliverse/dcs/bun`

- explicit Bun host entry point for Bun-native format adapters;
- semantic import/inspect for JSONC, JSON5, YAML, TOML, and text via Bun parsers;
- read-only bind and conversion helpers for foreign documents;
- still re-exports the host filesystem adapter while keeping Bun APIs out of the browser-safe root.

### `@reliverse/dcs/package-manifest`

`projectPackageManifest` is a pure, browser-safe transformation for an owning caller's exact workspace inventory and root manifest snapshot. It inherits root metadata, applies typed field overrides, replaces workspace patterns with existing package paths, reports root-only dependency exclusions and required missing workspace blockers, preserves Bun catalogs/registry overrides, and flags script review/obvious absent local paths. It does not discover files, resolve/install packages, execute scripts, create package stubs or grant candidate/publication authority. Unsupported protocols and recognized private references remain blockers. GR owns exact publication inputs, isolated Bun preflight, freshness and security enforcement.

## Future frontend rule

A frontend edits one selected persistent layer, never a fully materialized
effective config. It sends a structured patch with the `documentRevision`
returned by the server. A host detects conflicts before writing and exposes
optional semantic/effective revisions for UI state. Three-way rebase now applies only to non-overlapping paths; same-path edits
return structured conflicts. Identity collection edits return `collection-overlap` rather than silently choosing an order. JSONC writes remain AST-addressed and lossless.

## Deterministic build and headless editor

```ts
const definition = defineConfig({/* ... */});
const artifacts = await definition.buildArtifacts();

const model = createDcsEditorModel({
  bundle: definition.bundle,
  document: { document, documentRevision, semanticRevision, effectiveRevision },
  resolved,
  scope: "workspace",
});
```

`buildArtifacts()` produces schema, defaults, docs, editor descriptor, TypeScript
declarations, and a manifest with no timestamp or machine-specific data. The
headless editor model exposes only redacted values for secret fields and edits a
single chosen document layer, never a materialized effective configuration.

## Secrets boundary

The root SDK models secret references and opaque provider results but performs no ambient lookup. A resolved `DcsSecretValue` refuses serialization and string coercion. Node hosts must opt into an allowlisted provider adapter. `DcsEditorModel`, session views, rebase conflicts, and redacted provider results never expose raw secret material.

## Explicit profile overlays

The browser-safe SDK exposes `DcsProfileName` and profile-bound editor model/session
types. Filesystem hosts select a profile only through `@reliverse/dcs/node`
options; profile locations and writes live under that explicit host boundary.

## UI codegen host boundary

`@reliverse/dcs/node` exposes the project doctor and safe generation host for
optional `@reliverse/dcs-react` source output. The browser-safe SDK root does not
import React, Node builtins, or filesystem APIs.
