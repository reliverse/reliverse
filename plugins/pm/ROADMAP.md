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
- [x] Roll back manifest changes if final install fails

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
- [x] Support `--apply`
- [x] Run `bun update` or `bun install` depending on context
- [x] Roll back manifest changes if final install/update fails

### Current output and UX

- [x] Structured JSON output for automation
- [x] Action-level statuses: `updated`, `noop`, `skipped`, `missing`
- [x] Readable dry-run summary
- [x] Grouped dry-run specifier diff preview
- [x] Explicit update strategy reporting
- [x] Explicit final Bun command reporting
- [x] Explicit install cwd reporting

## v0.2.0, near-term quality upgrades

### Output and testing

- [ ] Add focused tests for `pm add`
- [ ] Add focused tests for `pm update`
- [ ] Add snapshot-like tests for JSON result payloads
- [ ] Add snapshot-like tests for human-readable dry-run output
- [ ] Normalize wording and payload shapes across `pm add` and `pm update`

### Update controls

- [ ] Add `--section <dependencies|devDependencies|peerDependencies|optionalDependencies>` filter for `pm update`
- [ ] Add `--ignore <pkg1,pkg2,...>` filter for `pm update`
- [ ] Add `--only <pkg1,pkg2,...>` style alternative if it proves clearer than positional args in some workflows
- [ ] Improve not-found diagnostics by showing where the command searched

### Strategy clarity

- [ ] Include clearer per-package strategy reasons in JSON output
- [ ] Include clearer per-package strategy reasons in text output
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

- [ ] Audit rollback behavior for all partial-failure scenarios
- [ ] Make transaction phases more explicit in code structure
- [ ] Improve failure messages around the final Bun step

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

### Nice-to-have, not committed

- [-] Support other package managers directly from this plugin
- [-] Deep lockfile diff rendering
- [-] Automatic upgrade migration notes per ecosystem package
