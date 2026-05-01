# `@reliverse/declar`

Declaration pipeline planning for modern TypeScript packages.

Declar does **not** replace TypeScript. It keeps the TypeScript compiler as the source of truth, then adds the package-publishing layer around declaration output: entrypoint discovery, export/type diagnostics, pipeline planning, and later declaration emit/validation stages.

```txt
package.json exports
  -> entrypoint discovery
  -> diagnostics
  -> declaration pipeline plan
  -> future TypeScript-backed emit + validation
```

`dler build` will eventually use `@reliverse/declar` as its declaration layer instead of growing declaration-specific logic inside the build command.

## Current status

Declar is currently at **Milestone 0.1**.

It supports:

- package entrypoint discovery
- declaration pipeline planning
- structured diagnostics

It does **not** emit `.d.ts` files yet. No TypeScript compiler execution, filesystem-aware validation, declaration rollup, or `package.json` rewriting happens in this milestone.

## Install

```bash
bun add @reliverse/declar
```

## Quick example

```ts
import { createDeclarPipelinePlan } from "@reliverse/declar";

const plan = createDeclarPipelinePlan({
  packageDir: process.cwd(),
  packageJson: {
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
    },
  },
  declarationMap: true,
});

console.log(plan.entrypoints);
console.log(plan.diagnostics);
```

Example plan shape:

```ts
{
  declarationMap: true,
  diagnostics: [],
  entrypoints: [
    {
      exportPath: ".",
      kind: "root",
      importPath: "./dist/index.js",
      runtimeConditions: [
        { condition: "import", path: "./dist/index.js" }
      ],
      typesConditions: [
        { condition: "types", path: "./dist/index.d.ts" }
      ],
      typesPath: "./dist/index.d.ts"
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
}
```

## Public API

### `discoverPackageEntrypoints(packageJson)`

Discovers public package entrypoints from parsed package metadata.

```ts
import { discoverPackageEntrypoints } from "@reliverse/declar";

const result = discoverPackageEntrypoints({
  exports: {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    },
    "./cli": {
      types: "./dist/cli.d.ts",
      import: "./dist/cli.js",
    },
  },
});
```

Returns:

- `entrypoints` — discovered public declaration surface
- `diagnostics` — structured issues found while reading package metadata

### `createDeclarPipelinePlan(options)`

Creates a declarative pipeline plan for later declaration work.

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

The current implementation plans stages only. It does not execute the TypeScript compiler or write files.

## Pipeline options

### `packageDir`

Package directory used as the base for future filesystem-aware stages.

### `packageJson`

Parsed package metadata. Declar receives this object instead of reading `package.json` directly in Milestone 0.1.

### `declarationMap`

Whether declaration maps should be requested during future TypeScript-backed declaration emit. Defaults to `false`.

Declaration maps are useful for editor flows like Go to Definition because they connect generated `.d.ts` files back to original `.ts` sources.

### `outDir`

Output directory for future declaration artifacts. Defaults to `dist`.

### `rollup`

Whether declaration bundling should be included in the pipeline plan. Defaults to `false`.

In Milestone 0.1 this only adds the `bundle-declarations` phase to the plan.

### `tsconfigPath`

Path to the TypeScript config file relative to `packageDir`. Defaults to `tsconfig.json`.

### `updatePackageJson`

Whether package metadata wiring should be included in the pipeline plan. Defaults to `false`.

In Milestone 0.1 this only adds the `wire-package-types` phase to the plan.

## Entrypoint model

Declar treats `package.json#exports` as the package's public declaration surface. This matters because users import through exports, not through arbitrary source files.

Each entrypoint has:

- `exportPath` — `"."`, `"./cli"`, `"./*"`, etc.
- `kind` — `"root"`, `"subpath"`, or `"pattern"`
- runtime targets such as `importPath`, `requirePath`, or `defaultPath`
- declaration targets such as `typesPath`, `importTypesPath`, or `requireTypesPath`
- normalized `runtimeConditions` and `typesConditions`

## Supported package shapes

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

This is valid runtime metadata, but Declar reports a diagnostic because no declaration target is declared.

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

### Versioned TypeScript types conditions

```json
{
  "exports": {
    ".": {
      "types@>=5.0": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

Declar treats `types@...` keys as valid declaration conditions.

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

This shape is useful when ESM and CJS artifacts need separate declaration files.

### Additional runtime conditions

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "browser": "./dist/index.browser.js",
      "default": "./dist/index.js"
    }
  }
}
```

Declar preserves supported string runtime targets like `browser` in `runtimeConditions`, but reports `DECLAR_EXPORT_CONDITION_UNSUPPORTED` because they are not primary Declar conditions yet.

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

Declar can detect pattern entrypoints. Full pattern validation is deferred until filesystem-aware validation exists.

## Diagnostics

Diagnostics are structured and designed to be rendered by `dler build` later.

```ts
export type DeclarDiagnosticSeverity = "info" | "warning" | "error";

export interface DeclarDiagnostic {
  readonly code: DeclarDiagnosticCode;
  readonly message: string;
  readonly path?: readonly string[] | undefined;
  readonly severity: DeclarDiagnosticSeverity;
}
```

Current diagnostic codes:

- `DECLAR_EXPORT_CONDITION_UNSUPPORTED`
- `DECLAR_EXPORT_MISSING_RUNTIME_TARGET`
- `DECLAR_EXPORT_MISSING_TYPES`
- `DECLAR_EXPORT_NESTED_CONDITIONS_UNSUPPORTED`
- `DECLAR_EXPORT_PATTERN_TYPES_UNVERIFIED`
- `DECLAR_EXPORT_TARGET_NOT_RELATIVE`
- `DECLAR_EXPORT_TYPES_CONDITION_NOT_FIRST`
- `DECLAR_EXPORT_UNSUPPORTED_SHAPE`
- `DECLAR_PACKAGE_MISSING_EXPORTS`

All Milestone 0.1 diagnostics currently use `severity: "warning"`.

Example:

```ts
{
  code: "DECLAR_EXPORT_MISSING_TYPES",
  message: "Export . does not declare a types condition.",
  path: ["package.json", "exports", "."],
  severity: "warning"
}
```

## Planned pipeline

Declar's planned executable pipeline is:

1. Load package metadata.
2. Load and resolve `tsconfig.json`.
3. Discover public package entrypoints.
4. Emit declarations through TypeScript.
5. Validate export/type wiring.
6. Optionally roll up declarations.
7. Optionally update `package.json`.
8. Return structured diagnostics and artifacts.

Milestone 0.1 only builds the plan and discovers entrypoints.

## Milestone 1: TypeScript-backed emit

Milestone 1 should use the TypeScript compiler API directly.

Goals:

- read `tsconfig.json`
- resolve `extends` and compiler options through the TypeScript config loader
- discover package entrypoints from `package.json#exports`
- run the TypeScript compiler API
- generate `.d.ts` using `emitDeclarationOnly`
- optionally enable `declarationMap`
- validate that every `package.json#exports` entry has matching `types`
- validate that emitted declaration files exist for declared type targets
- produce clear diagnostics

Reference: [TypeScript `declarationMap`](https://www.typescriptlang.org/tsconfig/declarationMap.html)

## Milestone 2: bundle mode

After raw declaration emit works, Declar should support bundled declarations per package entrypoint.

Goals:

- take emitted `.d.ts` files as input
- roll up declarations per entrypoint
- remove internal/private exports
- normalize imports
- generate files such as `dist/index.d.ts` and `dist/foo.d.ts`
- update `package.json` with correct `types` conditions
- keep output stable enough for publish-time diffs

Declaration rollup should stay opt-in until raw emit and package wiring validation are reliable.

## Milestone 3: fast isolated mode

The fast path should come after the TypeScript-backed path is correct.

Goals:

- support `isolatedDeclarations`
- generate declarations quickly for simple files without a full TypeScript program
- use an Oxc/TS-compatible transform path where safe
- fall back to TypeScript for complex files or unsupported syntax
- make fallback behavior explicit in diagnostics

Fast mode is an optimization, not a semantic replacement for TypeScript.

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
- surface Declar diagnostics in the same concise Dler report format
- fail publish-oriented builds when package export/type wiring is invalid
- keep declaration-specific behavior out of the main build command

This keeps Dler as the orchestrator and Declar as the declaration pipeline.

## Tests

Run the focused tests:

```bash
bun test packages/declar/src/package-exports.test.ts packages/declar/src/plan.test.ts
```

Or from the package directory:

```bash
bun --cwd packages/declar test
```
