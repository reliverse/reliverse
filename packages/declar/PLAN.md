# `@reliverse/declar` plan

## Milestone 3: Fast isolated declaration path

Status: **closed as opt-in experimental complete**.

M3 now provides a conservative fast isolated declaration path built on TypeScript 5.5+
`transpileDeclaration`. Fast mode remains opt-in, reports structured diagnostics, validates package/export targets before acceptance, and falls back to the TypeScript-backed path when Declar cannot prove the fast output is safe.

The fast path should come after the TypeScript-backed path is correct.

Fast mode is an optimization. It must not become a semantic replacement for TypeScript, and it must never silently publish declarations that Declar cannot validate.

## Goals

- Add support for packages using `isolatedDeclarations`.
- Add a fast isolated declaration emit path for simple, supported files.
- Use an Oxc/TypeScript-compatible declaration transform path where it is safe.
- Fall back to the TypeScript-backed path for complex files, unsupported syntax, or uncertain cases.
- Make every fast-path decision explicit and inspectable.
- Report diagnostics when Declar chooses the fast path, skips it, or falls back to TypeScript.
- Preserve the existing TypeScript-backed emit path as the correctness baseline.
- Validate fast-path output with the existing package/export validation pipeline.
- Keep fast mode opt-in until its behavior is proven stable.

## Fast path behavior

Declar should be able to decide, per package or per entrypoint, whether fast isolated declaration emit is safe.

The fast path may be used when:

- `isolatedDeclarations` is enabled or explicitly requested
- declaration emit can be produced without a full TypeScript program
- exported declarations are sufficiently annotated
- the syntax is supported by the selected fast emitter
- package entrypoint validation can still be performed after emit

Declar must fall back to the TypeScript-backed path when:

- `isolatedDeclarations` requirements are not satisfied
- the fast emitter reports unsupported syntax
- the file requires semantic information that the fast path cannot safely infer
- declaration output cannot be validated
- bundle mode requires behavior outside the fast emitter's safe subset
- Declar cannot prove that fast output matches the package's exported type targets

Fallbacks should be normal behavior, not fatal errors.

## Diagnostics

M3 should add diagnostics for fast-path decisions, for example:

- fast isolated declaration emit was used
- fast isolated declaration emit was skipped
- fast isolated declaration emit fell back to TypeScript
- unsupported syntax prevented fast emit
- missing export annotations prevented fast emit
- fast-path output failed validation
- fast-path output differed from the expected package declaration targets

Diagnostics should include enough context for build tools to explain the decision to users.

Example:

```txt
info DECLAR_FAST_PATH_USED
  isolated declaration emit was used for ./src/index.ts.

warning DECLAR_FAST_PATH_FALLBACK
  isolated declaration emit was skipped for ./src/cli.ts.
  Reason: exported function return type requires semantic inference.
  Fallback: TypeScript-backed declaration emit.

error DECLAR_FAST_PATH_INVALID_OUTPUT
  fast declaration output did not produce exports["./cli"].types target ./dist/cli.d.ts.
```

## Rollup strategy

M3 may include research for a more mature declaration rollup strategy, but it should not require a full semantic rollup implementation.

Acceptable M3 work:

- document the limits of the current text-level bundler
- compare possible future strategies
- evaluate whether Declar should delegate semantic rollup to a proven declaration bundler
- identify which rollup features require TypeScript symbol graph access
- keep the current bundler conservative and opt-in

Not required for M3:

- full TypeScript symbol-graph declaration rollup
- API Extractor-level declaration trimming
- API Extractor-level release-tag analysis
- semantic-safe pattern-export bundling beyond filesystem expansion

## Package metadata behavior

M3 should keep package metadata wiring conservative.

Declar should continue to:

- avoid rewriting `package.json` unless explicitly opted in
- avoid reshaping unusual `package.json#exports` forms silently
- report unsupported export shapes instead of guessing
- preserve user-authored export structure whenever possible

## Non-goals

M3 does not aim to:

- replace TypeScript's type checker
- replace the TypeScript-backed declaration emit path
- make fast mode the default for all packages
- make declaration bundling safe for every complex package shape
- implement a full TypeScript symbol-graph rollup
- implement API Extractor-level trimming or release-tag analysis
- silently reshape unusual `package.json#exports` forms
- silently publish fast-path output that failed validation

## Exit criteria

Status: **met for M3 experimental scope**.

Milestone 3 is complete when Declar can:

- [x] detect whether fast isolated declaration emit is eligible
- [x] generate declarations quickly for supported simple files
- [x] fall back to TypeScript for unsupported or unsafe cases
- [x] expose fast-path decisions through structured diagnostics
- [x] validate fast-path output against package exports
- [x] keep existing TypeScript-backed behavior unchanged
- [x] document the limits of fast mode and the current bundling strategy

## Milestone 4: Declaration rollup strategy

Status: **closed as strategy/API complete**.

M4 deliberately does not implement a full semantic rollup engine. The decision is:

- keep unbundled per-entrypoint declarations as the safest default;
- keep Declar's current text-level bundler conservative, opt-in, and TypeScript-validated;
- recommend delegated semantic rollup for package shapes that need TypeScript symbol graph access or API Extractor-level behavior.

Implemented M4 API:

- `assessDeclarDeclarationRollupStrategy(options)`
- recommendations:
  - `keep-unbundled-declarations`
  - `use-current-text-bundler`
  - `delegate-semantic-rollup`
- risk flags:
  - `pattern-entrypoints`
  - `split-import-require-types`
  - `unknown-entrypoint-shape`

M4 exit criteria:

- [x] document current bundler limits clearly
- [x] make the default recommendation explicit
- [x] provide a small public API build tools can call before enabling rollup
- [x] keep semantic rollup out of Declar core until a proven need/tooling direction exists
- [x] preserve M2/M3 behavior and validation gates

## Milestone 5: `dler` build integration

Status: **closed as initial dler integration complete**.

M5 wires Declar into the `dler build --apply` path through the generated internal package runner. Runtime bundling still runs first; when it succeeds, `dler` invokes Declar to emit TypeScript declarations for package entrypoints.

Implemented M5 behavior:

- `plugins/dler` depends on `@reliverse/declar` and `typescript`
- the internal build runner emits declarations after successful generated package builds
- source package exports like `./src/index.ts` are mapped to declaration outputs like `./dist/index.d.ts`
- packages with `src/` use `rootDir: "src"` for declaration layout stability
- declaration rollup remains disabled by default, matching the M4 recommendation
- package metadata rewriting remains disabled inside `dler build`
- Declar diagnostics are surfaced in build output and error diagnostics fail the build
- unsupported/non-TS package shapes are skipped with explicit reasons

M5 exit criteria:

- [x] integrate Declar into the `dler` generated build runner
- [x] keep runtime build failure separate from declaration failure
- [x] emit declarations for a real workspace target through `rse build --apply`
- [x] add dler-level tests for declaration emission and skip behavior
- [x] document the `dler` declaration layer

## Milestone 6: Cleanup and integration hardening

Status: **closed as cleanup/hardening complete**.

M6 tightens the M3-M5 work before adding another feature layer.

Implemented M6 behavior:

- cleaned duplicate future-milestone headings in this plan
- added explicit `files` support to Declar's TypeScript declaration emit path
- passed explicit source files through the fast isolated path too
- updated Declar docs to mention explicit file-limited emit
- hardened `dler` declaration emit to use public package entrypoints instead of every `tsconfig.json` source file
- ignored test/spec/bench/fixture source paths when deriving declaration entrypoints
- added regression tests so public entrypoints emit while `*.test.ts` declarations do not leak into `dist`

M6 exit criteria:

- [x] clean up milestone docs after M3-M5
- [x] avoid declaration output for private test files in `dler build`
- [x] keep `dler` declaration emit stable on a real workspace package
- [x] preserve existing Declar and dler test/typecheck gates

## Milestone 7: `dler pub` declaration artifact validation

Status: **closed as publish validation complete**.

M7 adds the publish-side safety gate that follows from M5/M6: `dler build` can produce declarations, and `dler pub` now refuses TypeScript packages whose publishable declaration surface is missing.

Implemented M7 behavior:

- `dler pub` validates declaration artifacts during publishable-target resolution
- packages with `tsconfig.json` must declare package type targets in `package.json`
- declared top-level/export `types` targets must point to `.d.ts`, `.d.mts`, or `.d.cts` files under `--publish-from`
- declared top-level/export `types` targets must exist on disk before publish preview/apply continues
- missing or source-pointing declaration artifacts skip the target with an explicit reason before npm staging
- JavaScript-only packages without `tsconfig.json` are not forced into declaration validation

M7 exit criteria:

- [x] prevent publish preview/apply for TypeScript packages with missing `.d.ts` artifacts
- [x] prevent publish preview/apply for TypeScript packages whose type targets still point at source files
- [x] prevent publish preview/apply for TypeScript packages with no declared type targets
- [x] keep existing publish eligibility and workspace-policy checks intact
- [x] document the publish declaration artifact gate

## Milestone 8: Package metadata wiring for publish artifacts

Status: **closed as staging metadata wiring complete**.

M8 closes the gap M7 intentionally exposed: workspace manifests may keep dev-friendly source metadata, while publish previews need dist-friendly package metadata.

Implemented M8 behavior:

- `dler pub` prepares publish metadata during publishable-target resolution
- source entrypoints such as `./src/index.ts` are mapped to `./dist/index.d.ts` for type targets
- source runtime entrypoints are mapped to `./dist/index.js`, `./dist/index.mjs`, or `./dist/index.cjs`
- publish validation runs against prepared metadata, not raw workspace metadata
- publish staging writes prepared metadata into the temporary package root
- workspace `package.json` is not rewritten by `dler pub`

M8 exit criteria:

- [x] allow dev-friendly source metadata in workspace manifests
- [x] stage dist-friendly package metadata for publish preview/apply
- [x] preserve declaration artifact validation from M7
- [x] verify `packages/declar` now passes metadata validation and reaches the next publish guard

## Milestone 9: Publish dependency metadata normalization

Status: **closed as dev-dependency stripping complete**.

M9 makes the staged publish manifest match the intended npm artifact shape: development-only dependency metadata stays in the workspace manifest, but does not ship to npm.

Implemented M9 behavior:

- `dler pub` removes `devDependencies` from prepared publish metadata
- unsafe publish specifier checks ignore `devDependencies`
- runtime dependency fields remain guarded: `dependencies`, `peerDependencies`, and `optionalDependencies`
- staging writes the prepared manifest without `devDependencies`
- workspace `package.json` remains unchanged

M9 exit criteria:

- [x] keep `devDependencies` in source manifests but omit them from npm staging
- [x] stop blocking publish preview on dev-only `workspace:`/`catalog:` specifiers
- [x] continue blocking unsafe runtime dependency specifiers
- [x] verify `packages/declar` reaches npm dry-run preview instead of metadata/specifier guards

## Milestone 10: Clean/prune publish artifacts

Status: **closed as staging prune complete**.

M10 prevents stale private declaration artifacts from leaking into npm tarball previews when old build output remains in `dist`.

Implemented M10 behavior:

- `dler pub` prunes ignored declaration artifacts from the temporary staging directory
- ignored filenames include `.test.`, `.spec.`, `.bench.`, and `.fixture.`
- only declaration artifacts are pruned: `.d.ts`, `.d.mts`, and `.d.cts`
- runtime files are left untouched
- workspace `dist` is not mutated by publish staging

M10 exit criteria:

- [x] remove stale private declaration artifacts from publish staging
- [x] preserve public declaration artifacts
- [x] keep runtime artifacts untouched
- [x] verify `packages/declar` npm dry-run tarball no longer includes stale test declarations

## Future milestones

Possible post-M5 work:

- mature TypeScript symbol-graph rollup
- delegated semantic rollup through a proven declaration bundler
- API Extractor-style trimming and release-tag analysis
- broader package metadata rewriting for unusual export shapes
- stable default fast mode for packages that fully satisfy isolated declaration requirements
