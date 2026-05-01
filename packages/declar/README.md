# `@reliverse/declar`

Declaration generation pipeline for modern TypeScript packages.

Declar is not an attempt to rewrite TypeScript. It is a focused declaration pipeline that makes TypeScript declaration generation predictable for package publishing:

```txt
TypeScript compiler emit
  -> Declar validations
  -> package entrypoints
  -> optional .d.ts rollup
  -> package.json types wiring
```

`dler build` will use `@reliverse/declar` as the declaration layer instead of growing declaration-specific logic inside the build command.

## Current status

Declar is currently at Milestone 0.1: package entrypoint discovery and declaration pipeline planning.

It does not emit `.d.ts` files yet.

## Current package shape

The initial package is intentionally small. It currently provides:

- public types for Declar plans, warnings, package entrypoints, and condition paths
- package entrypoint discovery from `package.json#exports`
- fallback entrypoint discovery from legacy `main`, `module`, `types`, and `typings` fields
- detection of root, subpath, and pattern entrypoints
- validation warnings for exports without matching `types`
- validation warnings for exports without runtime targets
- validation warnings for non-relative export targets
- validation warnings for `types` conditions that are not listed first
- basic support for nested `import.types` and `require.types` declaration conditions
- diagnostics for unsupported or partially-supported export condition shapes
- a minimal pipeline plan shape that `dler build` can consume later
- Bun tests for the current entrypoint discovery and pipeline planning behavior

No compiler execution happens yet. Milestone 1 will add the TypeScript-backed implementation.

## Philosophy

> Not "we rewrote TypeScript”, but "we built a proper declaration pipeline for modern packages”.

Declar keeps the TypeScript compiler as the source of truth for type analysis and declaration emit. The package adds the missing pipeline around it: entrypoint discovery, validation, warning UX, optional declaration bundling, and package metadata wiring.

The goal is not to guess types from arbitrary source files. The goal is to understand the package's public surface, emit declarations through the right backend, validate the result, and make publish-time type wiring boring.

## Why package entrypoints matter

Modern TypeScript packages usually expose their public API through `package.json#exports`.

A package can have one root entrypoint:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

Or multiple subpath entrypoints:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./cli": {
      "types": "./dist/cli.d.ts",
      "import": "./dist/cli.js"
    }
  }
}
```

Declar treats these entrypoints as the package's public declaration surface. That makes it possible to validate declaration output against what users can actually import.

## Supported entrypoint shapes

Declar currently understands these common package shapes.

### Legacy package fields

```json
{
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts"
}
```

### String exports

```json
{
  "exports": "./dist/index.js"
}
```

This is valid runtime metadata, but Declar will warn because no declaration target is declared.

### Root conditional exports

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  }
}
```

### Direct root conditional exports

```json
{
  "exports": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  }
}
```

### Nested import/require declaration conditions

```json
{
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.mts",
        "default": "./dist/index.mjs"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    }
  }
}
```

This shape is important for packages that publish separate ESM and CJS artifacts.

### Pattern exports

```json
{
  "exports": {
    "./*": {
      "types": "./dist/*.d.ts",
      "import": "./dist/*.js"
    }
  }
}
```

Declar can detect pattern entrypoints, but full pattern validation is intentionally deferred until filesystem-aware validation exists.

## Warning codes

Declar warnings are structured and designed to be rendered by `dler build` later.

Current warning codes:

- `DECLAR_EXPORT_CONDITION_UNSUPPORTED`
- `DECLAR_EXPORT_MISSING_RUNTIME_TARGET`
- `DECLAR_EXPORT_MISSING_TYPES`
- `DECLAR_EXPORT_NESTED_CONDITIONS_UNSUPPORTED`
- `DECLAR_EXPORT_PATTERN_TYPES_UNVERIFIED`
- `DECLAR_EXPORT_TARGET_NOT_RELATIVE`
- `DECLAR_EXPORT_TYPES_CONDITION_NOT_FIRST`
- `DECLAR_EXPORT_UNSUPPORTED_SHAPE`
- `DECLAR_PACKAGE_MISSING_EXPORTS`

Warnings are not just strings. They include a stable code, a human-readable message, and an optional path pointing back to the relevant package metadata location.

Example:

```ts
{
  code: "DECLAR_EXPORT_MISSING_TYPES",
  message: "Export . does not declare a types condition.",
  path: ["package.json", "exports", "."]
}
```

## Intended pipeline

```ts
import { createDeclarPipelinePlan } from "@reliverse/declar";

const plan = createDeclarPipelinePlan({
  packageDir: process.cwd(),
  packageJson,
  declarationMap: true,
});
```

The current implementation returns a declarative plan:

```ts
{
  declarationMap: true,
  entrypoints: [
    {
      exportPath: ".",
      kind: "root",
      importPath: "./dist/index.js",
      typesPath: "./dist/index.d.ts",
      runtimeConditions: [
        {
          condition: "import",
          path: "./dist/index.js"
        }
      ],
      typesConditions: [
        {
          condition: "types",
          path: "./dist/index.d.ts"
        }
      ]
    }
  ],
  outDir: "dist",
  packageDir: "/repo/packages/example",
  phases: [
    "read-tsconfig",
    "discover-entrypoints",
    "typescript-declaration-emit",
    "validate-package-types",
    "warn"
  ],
  rollup: false,
  tsconfigPath: "tsconfig.json",
  updatePackageJson: false,
  warnings: []
}
```

The future implementation should evolve this plan into executable stages:

1. Load package metadata.
2. Load and resolve `tsconfig.json`.
3. Discover public package entrypoints.
4. Emit declarations through TypeScript.
5. Validate export/type wiring.
6. Optionally roll up declarations.
7. Optionally update `package.json`.
8. Return structured warnings and artifacts.

## Pipeline options

```ts
import { createDeclarPipelinePlan } from "@reliverse/declar";

const plan = createDeclarPipelinePlan({
  packageDir: process.cwd(),
  packageJson,
  declarationMap: true,
  outDir: "dist",
  rollup: false,
  tsconfigPath: "tsconfig.json",
  updatePackageJson: false,
});
```

### `packageDir`

Package directory used as the base for future filesystem-aware stages.

### `packageJson`

Parsed package metadata. Declar intentionally receives this object instead of reading it directly in the current milestone.

### `declarationMap`

Whether declaration maps should be requested during TypeScript-backed declaration emit.

### `outDir`

Output directory for generated declaration artifacts. Defaults to `dist`.

### `rollup`

Whether declaration bundling should be included in the pipeline plan. Defaults to `false`.

### `tsconfigPath`

Path to the TypeScript config file relative to `packageDir`. Defaults to `tsconfig.json`.

### `updatePackageJson`

Whether package metadata wiring should be included in the pipeline plan. Defaults to `false`.

## Milestone 1: TypeScript-backed

Declar should first use the TypeScript compiler API directly.

Goals:

- read `tsconfig.json`
- resolve `extends` and compiler options through the TypeScript config loader
- discover package entrypoints from `package.json#exports`
- run the TypeScript compiler API
- generate `.d.ts` using `emitDeclarationOnly`
- optionally enable `declarationMap`
- validate that every `package.json#exports` entry has matching `types`
- validate that emitted declaration files exist for declared type targets
- produce clear, pretty warnings

Why `declarationMap` matters: TypeScript documents it as generating sourcemaps for declaration files, which helps editors map `.d.ts` declarations back to the original `.ts` source for features like Go to Definition.

Reference: [https://www.typescriptlang.org/tsconfig/declarationMap.html](https://www.typescriptlang.org/tsconfig/declarationMap.html)

## Milestone 2: bundle mode

After raw declaration emit works, Declar should support bundled declarations per package entrypoint.

Goals:

- take emitted `.d.ts` files as input
- roll up declarations per entrypoint
- remove internal/private exports
- normalize imports
- generate files such as `dist/index.d.ts` and `dist/foo.d.ts`
- update `package.json` with correct `types` conditions
- keep the output stable enough for publish-time diffs

This mode should not be the only path. Some packages may prefer unbundled declarations when that better matches their source structure.

Declaration rollup should be opt-in until raw emit and package wiring validation are reliable.

## Milestone 3: fast isolated mode

The fast path should come after the TypeScript-backed path is correct.

Goals:

- support `isolatedDeclarations`
- generate declarations quickly for simple files without a full TypeScript program
- use an Oxc/TS-compatible transform path where safe
- fall back to TypeScript for complex files or unsupported syntax
- make fallback behavior explicit in diagnostics

The important rule: fast mode is an optimization, not a semantic replacement for TypeScript.

## Tests

Run the current Declar tests with Bun:

```bash
bun test packages/declar/src/package-exports.test.ts packages/declar/src/plan.test.ts
```

Or run the package source tests:

```bash
bun test packages/declar/src
```

## Non-goals

- Replacing TypeScript's type checker.
- Guessing public API from arbitrary source files without package entrypoints.
- Hiding broken package metadata behind best-effort output.
- Bundling declarations by default before raw emit is reliable.
- Treating pattern exports as fully validated before filesystem-aware validation exists.
- Pretending ESM and CJS declaration wiring is always the same file.

## Relationship with `dler build`

`dler build` should eventually call Declar for declaration work:

- build JavaScript/runtime artifacts through the existing build provider
- delegate declaration generation to `@reliverse/declar`
- surface Declar warnings in the same concise Dler report format
- fail publish-oriented builds when package export/type wiring is invalid
- keep declaration-specific behavior out of the main build command

This keeps Dler as the orchestrator and Declar as the declaration pipeline.
