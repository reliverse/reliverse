# `@reliverse/dler-rse-plugin`

Build and publish plugin for the `rse` CLI.

## Purpose

This plugin contributes file-based `dler` command trees to the Reliverse developer CLI.

Typical command families include build and publishing flows such as:

- `rse build`
- `rse pub`

## Build declarations

`rse build --apply` runs the generated package build command first, then invokes `@reliverse/declar` as the declaration layer for TypeScript package targets.

The declaration layer:

- emits declarations through Declar's TypeScript-backed pipeline by default
- limits declaration emit to public package entrypoints instead of every file matched by `tsconfig.json`
- maps source package entrypoints such as `./src/index.ts` to declaration targets such as `./dist/index.d.ts`
- keeps package metadata rewriting disabled; `dler pub` can still publish from prepared artifacts
- keeps declaration rollup disabled by default; M4 recommends unbundled per-entrypoint declarations unless a package explicitly needs bundling
- prints Declar diagnostics in the build output and fails the build on error diagnostics

If a target has no `tsconfig.json` or no TypeScript package entrypoint, declaration emit is skipped with a short reason. Runtime bundling still succeeds or fails independently before Declar runs.

## Publish artifact validation

`rse pub` publishes from prepared artifacts, usually `dist`. For TypeScript packages, publish validation now checks declaration artifacts before npm staging:

- packages with `tsconfig.json` must declare package type targets in `package.json`
- declared `types` / export `types` targets must point to `.d.ts`, `.d.mts`, or `.d.cts` files under `--publish-from`
- declared `types` / export `types` targets must exist on disk
- missing declaration files skip the target before `npm publish --dry-run` or real publish

This keeps `dler pub` from previewing or publishing a package whose JavaScript artifact exists but whose public `.d.ts` surface is missing.

When a package keeps dev-friendly source metadata such as `exports["."].types: "./src/index.ts"`, `dler pub` prepares publish metadata for the staging package instead of rewriting the workspace manifest. Source entrypoints are mapped to `--publish-from` artifacts, for example `./src/index.ts` becomes `./dist/index.d.ts` for `types` and `./dist/index.js` for runtime conditions.

`devDependencies` are also removed from the staged publish manifest. They stay in the workspace `package.json`, but do not ship to npm. Unsafe specifier checks still apply to runtime dependency fields: `dependencies`, `peerDependencies`, and `optionalDependencies`.

The staging step prunes stale private declaration artifacts whose filenames include `.test.`, `.spec.`, `.bench.`, or `.fixture.` and end in `.d.ts`, `.d.mts`, or `.d.cts`. This is a publish-safety cleanup for leftover declaration files; runtime files are left untouched.

Current command policy:

- use `pub` as the stable user-facing publish command name
- prefer preview-first behavior when operating release flows
- keep help and result output automation-friendly and symmetric across `build` and `pub`

## Plugin model

This package is a Rempts plugin.

- Plugin metadata is defined in `src/index.ts`
- Command paths come from files under `src/cmds/`
- The plugin `name` is an internal identifier, not the command path

## Notes

- Built for the `rse` host CLI
- Follows the file-based plugin model documented in `packages/rempts/README.md`
