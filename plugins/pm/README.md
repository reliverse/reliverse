# `@reliverse/pm-rse-plugin`

Package-management plugin for the `rse` CLI.

## Purpose

This plugin contributes Bun-first package management commands to Reliverse CLI workflows.

Current command families include:

- `rse add`
- `rse update`
- `rse verify-lock`

## Behavior highlights

- workspace-aware target resolution
- Bun catalog support
- modern Bun-only project guard: `bun.lock` is required, while `bun.lockb` and other package-manager lockfiles are rejected
- preview-first mutating flows
- `--apply` for real execution in mutating commands
- rollback snapshots include package manifests and `bun.lock`
- apply transactions restore snapshots after install failures, partial write failures, or failed lock verification
- `bun.lock` verification for resolved package integrity metadata
- optional Socket.dev verification for the resolved lockfile tree
- JSON-friendly result payloads for automation
- snapshot-tested JSON and text preview contracts for `pm add` and `pm update`

## Output contracts

`pm add` and `pm update` both expose stable JSON preview fields for automation:

- `actions[]` with package-level status and specifier changes
- `apply` / `preview`
- `install` with command, cwd, enabled, and executed state
- `summary` counts
- target metadata (`target`; `pm update` also reports changed `targets[]`)

Text preview output for the core add/update flows is covered by snapshot-like command tests so wording drift is intentional rather than accidental.

For large repositories, `pm update` text previews also include an execution plan, manifest scan counts, and compact grouped diffs. JSON output keeps the full `actions[]` list and includes `executionPlan` metadata for automation. Non-safe-latest update actions include `reason` fields in JSON; text output shows those strategy decisions when `--explain` is passed.

## Update controls

`rse update` supports focused large-repo runs:

- `--section dependencies|devDependencies|peerDependencies|optionalDependencies` limits discovery to one manifest section
- `--ignore pkg1,pkg2` skips packages during discovery
- `--only pkg1,pkg2` is an explicit alternative to positional package args
- `--patch-only` updates within the current major/minor line
- `--minor-only` updates only to newer minor versions in the current major line
- `--no-major` updates within the current major line

Version policy flags are mutually exclusive and are not combined with `--safe-latest`. Peer dependencies intentionally use the same controls as other sections; use `--section peerDependencies` when you want to focus them.

## Safe latest updates

`rse update --safe-latest` selects the newest stable version that passes Rse's package metadata policy instead of blindly taking the newest publish. The current policy checks npm release age, deprecated package metadata, install-script risk, and optionally Socket.dev shallow alerts before choosing a candidate.

Useful flags:

```bash
rse update react --safe-latest --age 7d --explain
rse update --target packages/ui --safe-latest --fresh-scope @reliverse/* --json
rse update zod --safe-latest --socket --socket-severity-threshold high
rse update zod --safe-latest --require-socket --json
rse update --section dependencies --ignore react,react-dom
rse update --only vite,typescript --no-major
rse update --patch-only
```

Current defaults:

- minimum release age: `7d`
- fresh-scope bypass: `@reliverse/*`
- max fallback depth: `20` stable versions
- deprecated versions: blocked
- install-script versions: blocked unless policy internals allowlist them
- Socket shallow checks: disabled by default, optional with `--socket`, required with `--require-socket`; these use the local Socket CLI (`socket package shallow npm <pkg>@<version> --json`)

These defaults can live in optional `rse.config.json` / `rse.config.jsonc` under `pm.safeLatest`. Explicit CLI flags win over config values, and config values win over built-in defaults.

```json
{
  "pm": {
    "safeLatest": {
      "minimumReleaseAgeDays": 7,
      "allowFreshScopes": ["@reliverse/*"],
      "maxFallbackDepth": 20,
      "blockDeprecated": true,
      "blockInstallScripts": "unlessAllowlisted",
      "installScriptAllowlist": [],
      "socket": {
        "enabled": false,
        "require": false,
        "severityThreshold": "high"
      }
    }
  }
}
```

The JSON result includes a per-action `safeDecision` object with the selected version and skipped candidate reasons. Text output can show the same decision trail with `--explain`.

## Workspace and catalog behavior

- `--cwd` resolves the repo base; `--target` selects a workspace path or package name inside that repo.
- When the target is a Bun workspace root, `pm update` sweeps workspace manifests recursively by default; use `--no-recursive` to stay on the root manifest.
- Workspace package dependencies using `workspace:` are skipped by `pm update` because their versions are managed by the workspace itself.
- Catalog-backed dependencies are updated in the repo root catalog. `pm add` prefers catalog references for workspace package targets when a suitable catalog is present, and `--catalog <name>` writes `catalog:<name>` references.
- Missing package diagnostics report how many manifests were searched, whether the search was recursive, and which section/ignore controls affected discovery.

## Lockfile verification

`rse verify-lock` parses `bun.lock`, checks resolved registry package entries for integrity metadata, and can run Socket shallow checks against every resolved package version.

```bash
rse verify-lock
rse verify-lock --json
rse verify-lock --socket --json
rse verify-lock --require-socket --socket-severity-threshold high --json
```

`pm add` and `pm update` also verify `bun.lock` after a successful `bun install`. If verification fails during an apply transaction, manifest and lockfile snapshots are restored.

## Related docs

- Roadmap: [`./ROADMAP.md`](./ROADMAP.md)
- Rempts docs: [`../../packages/rempts/README.md`](../../packages/rempts/README.md)
- Rse CLI docs: [`../../apps/rse/README.md`](../../apps/rse/README.md)
