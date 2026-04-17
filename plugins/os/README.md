# `@reliverse/os-rse-plugin`

OS automation plugin for the `rse` CLI.

## Purpose

This plugin contributes host- and operating-system-oriented commands to the Reliverse developer CLI.

Current command families include:

- `rse os bootstrap`

## Notes

- Built on the Rempts file-based plugin model
- Prefer explicit mutating flows with `--apply`
- Prefer explicit replacement semantics such as `--overwrite` when the command is about replacing existing generated outputs

## Related docs

- Rempts docs: [`../../packages/rempts/README.md`](../../packages/rempts/README.md)
- Rse CLI docs: [`../../apps/cli/README.md`](../../apps/cli/README.md)
