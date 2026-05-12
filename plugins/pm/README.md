# `@reliverse/pm-rse-plugin`

Package-management plugin for the `rse` CLI.

## Purpose

This plugin contributes Bun-first package management commands to Reliverse CLI workflows.

Current command families include:

- `rse add`
- `rse update`

## Behavior highlights

- workspace-aware target resolution
- Bun catalog support
- modern Bun-only project guard: `bun.lock` is required, while `bun.lockb` and other package-manager lockfiles are rejected
- preview-first mutating flows
- `--apply` for real execution in mutating commands
- rollback snapshots include package manifests and `bun.lock`
- JSON-friendly result payloads for automation

## Safe latest updates

`rse update --safe-latest` selects the newest stable version that passes Rse's npm metadata policy instead of blindly taking the newest publish. The current policy checks release age, deprecated package metadata, and install-script risk before choosing a candidate.

Useful flags:

```bash
rse update react --safe-latest --age 7d --explain
rse update --target packages/ui --safe-latest --fresh-scope @reliverse/* --json
```

Current defaults:

- minimum release age: `7d`
- fresh-scope bypass: `@reliverse/*`
- max fallback depth: `20` stable versions
- deprecated versions: blocked
- install-script versions: blocked unless policy internals allowlist them

The JSON result includes a per-action `safeDecision` object with the selected version and skipped candidate reasons. Text output can show the same decision trail with `--explain`.

## Related docs

- Roadmap: [`./ROADMAP.md`](./ROADMAP.md)
- Rempts docs: [`../../packages/rempts/README.md`](../../packages/rempts/README.md)
- Rse CLI docs: [`../../apps/rse/README.md`](../../apps/rse/README.md)
