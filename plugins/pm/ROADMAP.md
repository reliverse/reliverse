# `@reliverse/pm-rse-plugin` Roadmap

This roadmap tracks what the `pm` plugin already supports and what we plan to improve next.

Legend:

- `[x]` shipped
- `[ ]` planned
- `[-]` deferred / not prioritized yet

## v0.1.0, current shipped foundation

### Core plugin shape

- [x] File-based Rempts plugin wired into `rse`
- [x] `pm add` command
- [x] `pm update` command
- [x] Bun-first execution model
- [x] JSON-friendly command results
- [x] Dry-run support for mutating flows
- [x] Non-interactive, automation-friendly defaults

### Target and workspace resolution

- [x] Resolve repo root from `--cwd`
- [x] Resolve target package from `--target`
- [x] Support targeting by workspace path
- [x] Support targeting by workspace package name
- [x] Detect Bun workspace roots automatically
- [x] Sweep workspace manifests recursively when updating monorepo root targets
- [x] Support `--no-recursive` for root-target updates

### `pm add`

- [x] Add dependencies to `dependencies`
- [x] Add dependencies to `devDependencies`
- [x] Add dependencies to `peerDependencies`
- [x] Add dependencies to `optionalDependencies`
- [x] Support explicit version input like `pkg@1.2.3`
- [x] Resolve latest version from npm when version is omitted
- [x] Support exact versions via `--exact`
- [x] Prefer Bun catalog-backed installs in workspace packages when available
- [x] Support named catalogs via `--catalog <name>`
- [x] Avoid silently changing version when dep already exists, and point callers to `pm update`
- [x] Run final `bun install`
- [x] Require modern Bun projects with `bun.lock` before mutating or resolving installs
- [x] Reject legacy/foreign lockfiles (`bun.lockb`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`)
- [x] Roll back manifest and `bun.lock` changes if final install fails

### `pm update`

- [x] Update selected packages by name
- [x] Update all direct dependencies when no package args are passed
- [x] Support workspace package targets and repo-root sweeps
- [x] Update catalog-backed dependencies through the repo catalog
- [x] Skip `workspace:` dependencies
- [x] Reject explicit version specifiers in `pm update`
- [x] Support `--no-latest` to stay within current semver range
- [x] Support smart update mode by default
- [x] Support `--no-smart`
- [x] Support `--safe-latest` npm metadata policy mode
- [x] Support safe-latest release-age gates with `--age`
- [x] Support safe-latest fresh scope bypasses with `--fresh-scope`
- [x] Support safe-latest fallback depth control with `--max-fallback-depth`
- [x] Support safe-latest policy defaults from `pm.safeLatest` in `rse.config.json` / `rse.config.jsonc`
- [x] Support safe-latest decision explanations with `--explain` and JSON `safeDecision` payloads
- [x] Support `--apply`
- [x] Run only `bun install` after pm-controlled manifest/catalog changes
- [x] Require modern Bun projects with `bun.lock` before mutating or resolving installs
- [x] Reject legacy/foreign lockfiles (`bun.lockb`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`)
- [x] Roll back manifest and `bun.lock` changes if final install fails

### Current output and UX

- [x] Structured JSON output for automation
- [x] Action-level statuses: `updated`, `noop`, `skipped`, `missing`
- [x] Readable preview summary
- [x] Grouped specifier diff preview
- [x] Explicit update strategy reporting
- [x] Explicit final Bun command reporting
- [x] Explicit install cwd reporting

## v0.2.0, near-term quality upgrades

### Output and testing

- [x] Add focused tests for pm lockfile safety
- [x] Add focused tests for safe-latest resolution policy
- [x] Add focused tests for transaction snapshot rollback including `bun.lock`
- [x] Add command-level focused tests for `pm add`
- [x] Add command-level focused tests for `pm update`
- [x] Add focused JSON result payload coverage for safe-latest update previews
- [x] Add focused human-readable output coverage for safe-latest `--explain` previews
- [ ] Add broader snapshot-like tests for JSON result payloads
- [ ] Add broader snapshot-like tests for human-readable preview output
- [ ] Normalize wording and payload shapes across `pm add` and `pm update`

### Update controls

- [ ] Add `--section <dependencies|devDependencies|peerDependencies|optionalDependencies>` filter for `pm update`
- [ ] Add `--ignore <pkg1,pkg2,...>` filter for `pm update`
- [ ] Add `--only <pkg1,pkg2,...>` style alternative if it proves clearer than positional args in some workflows
- [ ] Improve not-found diagnostics by showing where the command searched

### Strategy clarity

- [x] Include safe-latest per-package strategy reasons in JSON output
- [x] Include safe-latest per-package strategy reasons in text output via `--explain`
- [ ] Include clearer non-safe-latest per-package strategy reasons in JSON output
- [ ] Include clearer non-safe-latest per-package strategy reasons in text output
- [ ] Refine help text around `smart`, `latest`, and range-based resolution

## v0.3.0, safer large-repo update flows

### Version policy controls

- [ ] Add `--patch-only`
- [ ] Add `--minor-only`
- [ ] Add `--no-major`
- [ ] Decide whether peer dependency updates should have separate policy controls

### Planning and preview

- [ ] Show grouped manifest-level diffs even more compactly for large runs
- [ ] Add a clearer execution plan section before writes happen
- [ ] Improve repo-root recursive update reporting so workspace summaries stay compact

### Operational safety

- [x] Snapshot `bun.lock` during apply flows so failed installs can restore lockfile state
- [x] Split lockfile guard into a dedicated implementation module
- [x] Audit rollback behavior for all partial-failure scenarios beyond install failure
- [x] Make transaction phases more explicit in code structure
- [x] Improve failure messages around the final Bun step

## v0.4.0, optional power-user workflows

### Interactive flows

- [ ] Add `--interactive` or `--pick` mode for TTY selection before updating
- [ ] Keep non-TTY mode fail-fast and automation-safe

### Advanced execution modes

- [ ] Consider `--no-install` / write-only mode
- [ ] Consider install-only reconciliation mode if a real use case appears
- [ ] Consider bulk policy presets for CI vs local-dev workflows

## v1.0.0, stabilization goals

### Production readiness

- [ ] Stabilize JSON payload contracts for external automation
- [ ] Stabilize command help and examples
- [ ] Document all supported workspace/catalog behaviors clearly in README/ROADMAP/docs
- [ ] Reach strong test coverage for add/update core flows
- [ ] Validate behavior against several real Bun monorepo layouts

### Config integration

- [x] Contribute `pm.safeLatest` schema/defaults for `rse config generate`
- [x] Use precedence `explicit CLI flags > rse.config.json > built-in defaults` for safe-latest policy

### Supply-chain safety

- [ ] Add optional Socket shallow checks for safe-latest candidates
- [ ] Add `--require-socket` for CI-grade safe-latest runs
- [ ] Add resolved-tree verification after `bun install`
- [ ] Add `rse verify-lock --socket --json` for existing lockfiles

### Nice-to-have, not committed

- [-] Support other package managers directly from this plugin
- [-] Deep lockfile diff rendering
- [-] Automatic upgrade migration notes per ecosystem package
