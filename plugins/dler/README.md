# `@reliverse/dler-rse-plugin`

Build and publish plugin for the `rse` CLI.

## Purpose

This plugin contributes file-based `dler` command trees to the Reliverse developer CLI.

Typical command families include build and publishing flows such as:

- `rse dler build`
- `rse dler pub`

Current command policy:

- use `pub` as the stable user-facing publish command name
- prefer dry-run / preview-first behavior when operating release flows
- keep help and result output automation-friendly and symmetric across `build` and `pub`

## Plugin model

This package is a Rempts plugin.

- Plugin metadata is defined in `src/index.ts`
- Command paths come from files under `src/cmds/`
- The plugin `name` is an internal identifier, not the command path

## Notes

- Built for the `rse` host CLI
- Follows the file-based plugin model documented in `packages/rempts/README.md`
