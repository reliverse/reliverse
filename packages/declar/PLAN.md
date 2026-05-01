# `@reliverse/declar` plan

## Milestone 3: Fast isolated declaration path

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

Milestone 3 is complete when Declar can:

- detect whether fast isolated declaration emit is eligible
- generate declarations quickly for supported simple files
- fall back to TypeScript for unsupported or unsafe cases
- expose fast-path decisions through structured diagnostics
- validate fast-path output against package exports
- keep existing TypeScript-backed behavior unchanged
- document the limits of fast mode and the current bundling strategy

## Future milestones

Possible post-M3 work:

- mature TypeScript symbol-graph rollup
- delegated semantic rollup through a proven declaration bundler
- API Extractor-style trimming and release-tag analysis
- broader package metadata rewriting for unusual export shapes
- stable default fast mode for packages that fully satisfy isolated declaration requirements
