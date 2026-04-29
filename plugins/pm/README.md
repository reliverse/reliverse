# `@reliverse/pm-rse-plugin`

Package-management plugin for the `rse` CLI.

## Purpose

This plugin contributes Bun-first package management commands to Reliverse CLI workflows.

Current command families include:

- `rse pm add`
- `rse pm update`

## Behavior highlights

- workspace-aware target resolution
- Bun catalog support
- preview-first mutating flows
- `--apply` for real execution in `pm update`
- JSON-friendly result payloads for automation

## Related docs

- Roadmap: [`./ROADMAP.md`](./ROADMAP.md)
- Rempts docs: [`../../packages/rempts/README.md`](../../packages/rempts/README.md)
- Rse CLI docs: [`../../apps/rse/README.md`](../../apps/rse/README.md)
