# `@reliverse/declar`

Declaration pipeline for modern TypeScript packages.

Declar does **not** replace TypeScript. It keeps the TypeScript compiler as the source of truth, then adds the missing package-publishing layer around declaration output:

```txt
package.json exports
  -> entrypoint discovery
  -> structured diagnostics
  -> tsconfig loading
  -> TypeScript-backed declaration emit
  -> package export/type validation
  -> future declaration rollup + package.json wiring
```

`dler build` will use `@reliverse/declar` as its declaration layer instead of growing declaration-specific logic inside the build command.

## Current status

Declar has completed **Milestone 0** and has started **Milestone 1**.

Milestone 0 is closed:

- package entrypoint discovery
- declaration pipeline planning
- structured diagnostics
- diagnostic severity support
- support for common `package.json#exports` shapes

Milestone 1 has started:

- filesystem-aware declaration target validation
- `tsconfig.json` loading through a TypeScript compiler adapter
- first TypeScript-backed declaration emit primitive
- error-level diagnostics for missing files, invalid tsconfig, unavailable compiler adapters, and failed TypeScript emit

Declar can now model and validate more of the real declaration pipeline, but it is still early. It does **not** yet provide declaration rollup or automatic `package.json` rewriting.

## Install

```bash
bun add @reliverse/declar
```

## Recommended package metadata

For published packages, Declar recommends shipping built files from `dist` instead of exporting raw TypeScript source files.

Recommended ESM package shape:

```json
{
  "type": "module",
  "sideEffects": false,
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md"]
}
```

Keep both:

```json
"types": "./dist/index.d.ts"
```

and:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts"
  }
}
```

The `exports["."].types` condition is the modern package-entrypoint source of truth for TypeScript-aware resolution in `node16`, `nodenext`, and `bundler` module resolution modes. TypeScript explicitly matches the `types` condition when resolving through `package.json#exports`.

The top-level `types` field is still recommended even when `exports["."].types` already points to the same declaration file. It provides compatibility for resolution modes or tools that do not read `exports`, and TypeScript’s own documentation notes that npm shows the TS icon on the registry listing only when `package.json` contains a top-level `types` field.

Declar also recommends keeping the `types` condition first in each export object:

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

Avoid adding `"default"` unless you intentionally want a generic fallback target for runtimes or bundlers that do not match a more specific condition.

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

console.log(result.entrypoints);
console.log(result.diagnostics);
```

Returns:

- `entrypoints` — discovered public declaration surface
- `diagnostics` — structured issues found while reading package metadata

### `createDeclarPipelinePlan(options)`

Creates a declarative pipeline plan for declaration work.

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

This function plans stages. It does not execute the TypeScript compiler or write files.

### `validateDeclarEntrypointFiles(options)`

Validates that declared package export targets exist on disk.

```ts
import { discoverPackageEntrypoints, validateDeclarEntrypointFiles } from "@reliverse/declar";

const discovery = discoverPackageEntrypoints(packageJson);

const validation = await validateDeclarEntrypointFiles({
  packageDir: process.cwd(),
  entrypoints: discovery.entrypoints,
});

console.log(validation.diagnostics);
```

By default, Declar validates declaration targets from `types` conditions.

Runtime targets can also be checked:

```ts
await validateDeclarEntrypointFiles({
  packageDir: process.cwd(),
  entrypoints: discovery.entrypoints,
  checkRuntimeTargets: true,
});
```

Pattern targets such as `./dist/*.d.ts` are currently skipped by direct filesystem validation. Full pattern expansion will come later.

### `loadDeclarTsconfig(options)`

Loads and parses `tsconfig.json` through a TypeScript compiler adapter.

```ts
import { loadDeclarTsconfig } from "@reliverse/declar";
import ts from "typescript";

const result = loadDeclarTsconfig({
  packageDir: process.cwd(),
  compiler: ts,
  tsconfigPath: "tsconfig.json",
  outDir: "dist",
  declarationMap: true,
});

console.log(result.parsedCommandLine);
console.log(result.diagnostics);
```

Declar expects the compiler adapter to provide TypeScript-compatible APIs such as:

- `sys`
- `readConfigFile`
- `parseJsonConfigFileContent`
- optionally `flattenDiagnosticMessageText`

The tsconfig loader forces declaration-oriented compiler options:

- `declaration: true`
- `emitDeclarationOnly: true`
- `noEmit: false`
- `declarationMap` from Declar options
- `outDir` from Declar options

### `emitTypeScriptDeclarations(options)`

Runs the first TypeScript-backed declaration emit path.

```ts
import { emitTypeScriptDeclarations } from "@reliverse/declar";
import ts from "typescript";

const result = await emitTypeScriptDeclarations({
  packageDir: process.cwd(),
  packageJson,
  compiler: ts,
  tsconfigPath: "tsconfig.json",
  outDir: "dist",
  declarationMap: true,
});

console.log(result.emittedFiles);
console.log(result.diagnostics);
```

This is an early Milestone 1 primitive. It is intentionally compiler-backed and does not try to replace TypeScript semantics.

The function:

1. loads `tsconfig.json`
2. creates declaration-oriented compiler options
3. creates a TypeScript program
4. emits declaration files with `emitDeclarationOnly`
5. optionally validates declared package type targets

It does not roll up declarations and does not rewrite `package.json`.

### Diagnostic helpers

```ts
import {
  createDeclarDiagnostic,
  createDeclarError,
  createDeclarWarning,
  hasDeclarErrors,
} from "@reliverse/declar";
```

These helpers are used internally and can also be useful for integrations that compose Declar diagnostics with their own checks.

## Pipeline options

### `packageDir`

Package directory used as the base for filesystem-aware stages.

### `packageJson`

Parsed package metadata. Declar receives this object instead of reading `package.json` directly.

### `declarationMap`

Whether declaration maps should be requested during TypeScript-backed declaration emit. Defaults to `false`.

Declaration maps are useful for editor flows like Go to Definition because they connect generated `.d.ts` files back to original `.ts` sources.

### `outDir`

Output directory for declaration artifacts. Defaults to `dist`.

### `rollup`

Whether declaration bundling should be included in the pipeline plan. Defaults to `false`.

This only adds the `bundle-declarations` phase to the plan. Declaration rollup is not implemented yet.

### `tsconfigPath`

Path to the TypeScript config file relative to `packageDir`. Defaults to `tsconfig.json`.

### `updatePackageJson`

Whether package metadata wiring should be included in the pipeline plan. Defaults to `false`.

This only adds the `wire-package-types` phase to the plan. Automatic package rewriting is not implemented yet.

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

Declar can detect pattern entrypoints. Direct pattern validation is deferred until filesystem-aware pattern expansion exists.

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

- `DECLAR_DECLARATION_TARGET_MISSING`
- `DECLAR_EXPORT_CONDITION_UNSUPPORTED`
- `DECLAR_EXPORT_MISSING_RUNTIME_TARGET`
- `DECLAR_EXPORT_MISSING_TYPES`
- `DECLAR_EXPORT_NESTED_CONDITIONS_UNSUPPORTED`
- `DECLAR_EXPORT_PATTERN_TYPES_UNVERIFIED`
- `DECLAR_EXPORT_TARGET_NOT_RELATIVE`
- `DECLAR_EXPORT_TYPES_CONDITION_NOT_FIRST`
- `DECLAR_EXPORT_UNSUPPORTED_SHAPE`
- `DECLAR_PACKAGE_MISSING_EXPORTS`
- `DECLAR_RUNTIME_TARGET_MISSING`
- `DECLAR_TARGET_OUTSIDE_PACKAGE`
- `DECLAR_TSCONFIG_PARSE_FAILED`
- `DECLAR_TSCONFIG_READ_FAILED`
- `DECLAR_TYPESCRIPT_COMPILER_UNAVAILABLE`
- `DECLAR_TYPESCRIPT_EMIT_FAILED`

Metadata and export-shape diagnostics usually use `severity: "warning"`.

Filesystem, tsconfig, and compiler execution failures use `severity: "error"`.

Example warning:

```ts
{
  code: "DECLAR_EXPORT_MISSING_TYPES",
  message: "Export . does not declare a types condition.",
  path: ["package.json", "exports", "."],
  severity: "warning"
}
```

Example error:

```ts
{
  code: "DECLAR_DECLARATION_TARGET_MISSING",
  message: "Export . declares types at ./dist/index.d.ts, but the declaration file does not exist.",
  path: ["package.json", "exports", "."],
  severity: "error"
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

Milestone 1 implements the first executable pieces of this pipeline.

## Milestone 0: entrypoint discovery and planning

Status: done.

Completed:

- discover package entrypoints from `package.json#exports`
- support legacy `main`, `module`, `types`, and `typings`
- support string exports
- support root and subpath conditional exports
- support direct root conditional exports
- support versioned `types@...` conditions
- support nested `import.types` and `require.types`
- detect pattern exports
- preserve runtime conditions
- report structured diagnostics
- expose a declaration pipeline plan

## Milestone 1: TypeScript-backed emit and validation

Status: in progress.

Implemented:

- load `tsconfig.json` through a TypeScript-compatible compiler adapter
- force declaration-oriented compiler options
- create a TypeScript program through the provided compiler adapter
- emit declaration files through TypeScript
- validate declared declaration targets on disk
- optionally validate runtime targets on disk
- report error-level diagnostics for broken executable pipeline stages

Remaining:

- make the TypeScript adapter integration smoother for the package's chosen compiler dependency
- add more end-to-end emit tests with temporary fixture packages
- improve emitted-file to export-target validation
- expand pattern target validation
- decide how strict publish-oriented validation should be by default
- integrate the executable pipeline into `dler build`

## Milestone 2: bundle mode

After raw declaration emit works reliably, Declar should support bundled declarations per package entrypoint.

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
- Treating pattern exports as fully validated before filesystem-aware pattern expansion exists.
- Pretending ESM and CJS declaration wiring is always the same file.
- Rewriting `package.json` without explicit opt-in.
- Using a fast declaration transform as a semantic replacement for TypeScript.

## Relationship with `dler build`

`dler build` will use Declar for declaration work:

- build JavaScript/runtime artifacts through the existing build provider
- delegate declaration generation to `@reliverse/declar`
- surface Declar diagnostics in the same concise Dler report format
- fail publish-oriented builds when package export/type wiring is invalid
- keep declaration-specific behavior out of the main build command

This keeps Dler as the orchestrator and Declar as the declaration pipeline.

## Tests

Just run all Declar tests (bun test is fast):

```bash
bun test packages/declar
```
