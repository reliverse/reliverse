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

## Build strategy contract

`rse build` is preview-first. Pass `--apply` to run the generated build plan.

Runtime bundling is controlled by:

```bash
rse build --bundle-strategy auto|single|split
```

- `auto` — default. Plugin/CLI targets use `single`; package libraries use `split`.
- `single` — emits one runtime bundle, normally `dist/index.js`.
- `split` — emits one output per discovered package entrypoint under `dist`.

Declaration generation is controlled by:

```bash
rse build --declaration-strategy emit|fast|rollup|off
```

- `emit` — default. Use Declar's TypeScript-backed unbundled declaration emit.
- `fast` — try Declar's isolated fast declaration path and fall back to TypeScript when unsafe.
- `rollup` — ask Declar to emit and roll up declarations.
- `off` — skip the in-process Declar declaration layer.

The JSON preview reports the requested strategies and each step's resolved bundle/declaration strategy so automation can verify the plan before `--apply`.

## Publish staging, pack validation, and policy

`rse pub` stages a temporary npm package root instead of mutating the workspace manifest. The staged `package.json` is prepared from the workspace manifest and the selected `--publish-from` directory.

Publish validation now checks multiple layers before any real publish:

1. workspace/package eligibility;
2. prepared package metadata points at real files (`exports`, `main`, `module`, `types`, `bin`);
3. dependency specifiers are publish-safe for runtime dependency fields;
4. `npm pack --dry-run --json` succeeds from the staging directory;
5. the packed tarball passes policy checks.

Pack policy currently skips suspicious tarballs when they:

- miss `package.json`;
- miss files under `--publish-from` (`dist/` by default);
- include TS source files (`.ts`, `.tsx`, `.mts`, `.cts`) except declaration files;
- include JS source maps;
- include tests or fixtures;
- miss `dist/index.js` in effective `single` bundle mode.

Verbose text output shows a compact tarball preview. JSON output includes `published[].pack` with filename, size, unpacked size, and file list.

## Smoke matrix

Use this matrix when touching build, Declar, staging, or publish behavior.

| Area                             | Command                                                                                                                                         | Expected signal                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Build preview contract           | `bun test plugins/dler/src/cmds/build/cmd.test.ts`                                                                                              | JSON/text preview shape stays stable                                                     |
| Build plan/provider/declarations | `bun test plugins/dler/src/impl/build`                                                                                                          | build command planning and Declar layer still pass                                       |
| Publish validation/staging/pack  | `bun test plugins/dler/src/impl/pub plugins/dler/src/cmds/pub/cmd.test.ts`                                                                      | metadata rewrite, staging, pack preview, and pack policy pass                            |
| Plugin command discovery         | `bun test packages/rempts/src/runtime/discover-command.test.ts packages/rempts/src/api/define-plugin.test.ts`                                   | inline plugin commands still resolve after bundling                                      |
| dler typecheck                   | `bun run --cwd plugins/dler typecheck`                                                                                                          | TypeScript contract is clean                                                             |
| dler bundle smoke                | `bun build plugins/dler/src/index.ts --outfile /tmp/dler-bundle-check/index.js --target bun --external @reliverse/rempts --external typescript` | plugin bundles into one entrypoint without embedding the host API or TypeScript compiler |

For the bundle smoke, also verify the output does not contain the removed `internal-runner` path, does not contain a bundled `typescript/lib/typescript` compiler payload, and does contain the relevant command contract text for the feature being changed.

## Release checklist

Use this before a real package publish. Keep `pub` preview-only until every previous step is clean.

1. Confirm the working tree only contains intentional release changes.
2. Build the target with explicit strategies:

   ```bash
   rse build --targets <target> --bundle-strategy auto --declaration-strategy emit --apply --json
   ```

   Use `--bundle-strategy split` for package libraries with subpath exports and `--bundle-strategy single` for CLI/plugin packages that should ship one runtime bundle.

3. Run publish preview and inspect `published[].pack`:

   ```bash
   rse pub --targets <target> --bundle-strategy auto --json
   ```

4. Verify the tarball contains only expected `dist/` artifacts and `package.json`; no source files, source maps, tests, fixtures, or missing declaration files.
5. For multi-target releases, repeat preview on the exact target list before publishing.
6. Only then run the real publish:

   ```bash
   rse pub --targets <target> --bundle-strategy auto --apply --json
   ```

Production smoke examples used for this flow:

```bash
rse build --targets packages/declar --bundle-strategy split --declaration-strategy emit --apply --json
rse pub --targets packages/declar --bundle-strategy split --json
rse build --targets plugins/dler --bundle-strategy single --declaration-strategy emit --apply --json
rse pub --targets plugins/dler --bundle-strategy single --json
```

## Plugin model

This package is a Rempts plugin.

- Plugin metadata is defined in `src/index.ts`
- Commands are registered inline through `definePlugin({ commands: [...] })` so the plugin can bundle into one runtime entrypoint
- The plugin `name` is an internal identifier, not the command path

## Notes

- Built for the `rse` host CLI
- Follows the file-based plugin model documented in `packages/rempts/README.md`
