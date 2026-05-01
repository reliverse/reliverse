# `@reliverse/declar`

Declaration pipeline for modern TypeScript packages.

Declar does **not** replace TypeScript. It keeps the TypeScript compiler as the source of truth, then adds the missing package-publishing layer around declaration output:

```txt
package.json exports
  -> entrypoint discovery
  -> structured diagnostics
  -> tsconfig loading
  -> TypeScript-backed declaration emit
  -> emitted-file validation
  -> package export/type validation
  -> early declaration bundling
  -> future package.json wiring
```

`dler build` will use `@reliverse/declar` as its declaration layer instead of growing declaration-specific logic inside the build command.

## Current status

Declar has completed **Milestone 0** and **Milestone 1**. **Milestone 2** has started.

Milestone 0 is closed:

- package entrypoint discovery
- declaration pipeline planning
- structured diagnostics
- diagnostic severity support
- support for common `package.json#exports` shapes

Milestone 1 is closed:

- filesystem-aware declaration target validation
- filesystem-aware pattern target validation
- `tsconfig.json` loading through a TypeScript compiler adapter
- first TypeScript-backed declaration emit primitive
- emitted declaration target validation
- smoother TypeScript compiler integration through either an explicit compiler adapter or automatic `typescript` loading
- end-to-end declaration emit tests with temporary fixture packages
- error-level diagnostics for missing files, invalid tsconfig, unavailable compiler adapters, failed TypeScript emit, and declaration targets that were not emitted

Milestone 2 has started:

- first raw declaration bundle primitive
- local `.d.ts` import/re-export inlining
- optional `rollup: true` flow after TypeScript-backed emit
- bundle diagnostics for missing entrypoints, unsupported pattern targets, unresolved local imports, read/write failures, and bundle cycles

Declar can now model, emit, validate, and start bundling declaration output, but bundle mode is still early. It does **not** yet provide a semantic API Extractor-style declaration rollup or automatic `package.json` rewriting.

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

When `rollup: true` is enabled, the plan includes the `bundle-declarations` phase. The executable `emitTypeScriptDeclarations` flow can now run the first raw bundle primitive after successful emit and validation.

When `updatePackageJson: true` is enabled, the plan includes the `wire-package-types` phase. Automatic package rewriting is still not implemented.

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

Pattern targets such as `./dist/*.d.ts` are validated when the filesystem host can list files. The default host supports recursive directory reads.

### `validateDeclarEmittedFiles(options)`

Validates that TypeScript actually emitted the declaration targets declared by package exports.

```ts
import { discoverPackageEntrypoints, validateDeclarEmittedFiles } from "@reliverse/declar";

const discovery = discoverPackageEntrypoints(packageJson);

const validation = validateDeclarEmittedFiles({
  packageDir: process.cwd(),
  entrypoints: discovery.entrypoints,
  emittedFiles: ["/repo/packages/example/dist/index.d.ts"],
});

console.log(validation.diagnostics);
```

This catches cases where a stale file exists in `dist`, but the current TypeScript emit did not produce the declaration target declared in `package.json#exports`.

Pattern declaration targets are checked against emitted files too.

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

Runs the TypeScript-backed declaration emit path.

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
console.log(result.bundledFiles);
console.log(result.diagnostics);
```

Declar can use an explicit compiler adapter:

```ts
await emitTypeScriptDeclarations({
  packageDir: process.cwd(),
  packageJson,
  compiler: ts,
});
```

If no compiler is passed, Declar tries to load `typescript` automatically from the runtime environment:

```ts
await emitTypeScriptDeclarations({
  packageDir: process.cwd(),
  packageJson,
});
```

The function:

1. resolves a TypeScript compiler adapter
2. loads `tsconfig.json`
3. creates declaration-oriented compiler options
4. creates a TypeScript program
5. checks pre-emit diagnostics
6. emits declaration files with `emitDeclarationOnly`
7. validates that declared package type targets were emitted
8. validates declared package type targets on disk
9. optionally validates runtime targets on disk
10. optionally runs the early declaration bundle primitive when `rollup: true`

It does not automatically rewrite `package.json`.

Options:

```ts
await emitTypeScriptDeclarations({
  packageDir: process.cwd(),
  packageJson,
  compiler: ts,
  declarationMap: true,
  outDir: "dist",
  tsconfigPath: "tsconfig.json",
  checkRuntimeTargets: false,
  validateEmittedFiles: true,
  rollup: false,
});
```

`validateEmittedFiles` defaults to `true`.

### `bundleTypeScriptDeclarations(options)`

Runs the first raw declaration bundle primitive.

```ts
import { bundleTypeScriptDeclarations, discoverPackageEntrypoints } from "@reliverse/declar";

const discovery = discoverPackageEntrypoints(packageJson);

const result = await bundleTypeScriptDeclarations({
  packageDir: process.cwd(),
  entrypoints: discovery.entrypoints,
});

console.log(result.bundles);
console.log(result.diagnostics);
```

The current bundle primitive:

- starts from concrete `types` declaration targets
- reads emitted `.d.ts`, `.d.mts`, or `.d.cts` files
- inlines local declaration imports and re-exports
- keeps external package imports untouched
- strips declaration source map comments
- writes the bundled declaration back to the entrypoint declaration file by default

Use `write: false` to preview bundle contents without changing files:

```ts
const result = await bundleTypeScriptDeclarations({
  packageDir: process.cwd(),
  entrypoints: discovery.entrypoints,
  write: false,
});
```

Use `banner: false` to omit the generated banner:

```ts
await bundleTypeScriptDeclarations({
  packageDir: process.cwd(),
  entrypoints: discovery.entrypoints,
  banner: false,
});
```

This is an early Milestone 2 primitive. It is useful for simple local declaration graphs, but it is not yet a semantic API Extractor-style rollup.

### `collectDeclarDeclarationBundleTargets(entrypoints)`

Collects concrete declaration bundle targets from discovered entrypoints.

```ts
import {
  collectDeclarDeclarationBundleTargets,
  discoverPackageEntrypoints,
} from "@reliverse/declar";

const discovery = discoverPackageEntrypoints(packageJson);
const targets = collectDeclarDeclarationBundleTargets(discovery.entrypoints);

console.log(targets);
```

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

Whether declaration bundling should be included in the pipeline plan and executable emit flow. Defaults to `false`.

In the executable flow, `rollup: true` runs `bundleTypeScriptDeclarations` after successful TypeScript-backed emit and validation.

Bundle mode is currently early and best suited for simple local `.d.ts` graphs.

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

Declar can detect pattern entrypoints and validate pattern targets when the filesystem host can list files.

Pattern targets are not supported by the early declaration bundle primitive yet, because bundling needs concrete declaration files.

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

- `DECLAR_BUNDLE_CYCLE`
- `DECLAR_BUNDLE_ENTRYPOINT_MISSING`
- `DECLAR_BUNDLE_PATTERN_TARGET_UNSUPPORTED`
- `DECLAR_BUNDLE_READ_FAILED`
- `DECLAR_BUNDLE_UNRESOLVED_LOCAL_IMPORT`
- `DECLAR_BUNDLE_WRITE_FAILED`
- `DECLAR_DECLARATION_TARGET_MISSING`
- `DECLAR_DECLARATION_TARGET_NOT_EMITTED`
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

Filesystem, emitted-file, tsconfig, compiler execution, and bundle execution failures use `severity: "error"`.

Example warning:

```ts
{
  code: "DECLAR_EXPORT_MISSING_TYPES",
  message: "Export . does not declare a types condition.",
  path: ["package.json", "exports", "."],
  severity: "warning"
}
```

Example missing-file error:

```ts
{
  code: "DECLAR_DECLARATION_TARGET_MISSING",
  message: "Export . declares types at ./dist/index.d.ts, but the declaration file does not exist.",
  path: ["package.json", "exports", "."],
  severity: "error"
}
```

Example emitted-file error:

```ts
{
  code: "DECLAR_DECLARATION_TARGET_NOT_EMITTED",
  message: "Export . declares types at ./dist/index.d.ts, but TypeScript did not emit that declaration file.",
  path: ["package.json", "exports", "."],
  severity: "error"
}
```

Example bundle error:

```ts
{
  code: "DECLAR_BUNDLE_UNRESOLVED_LOCAL_IMPORT",
  message: "Declar could not resolve local declaration import \"./foo\" from /repo/packages/example/dist/index.d.ts.",
  path: ["/repo/packages/example/dist/index.d.ts"],
  severity: "error"
}
```

## Planned pipeline

Declar's planned executable pipeline is:

1. Load package metadata.
2. Load and resolve `tsconfig.json`.
3. Discover public package entrypoints.
4. Emit declarations through TypeScript.
5. Validate emitted declaration files against package exports.
6. Validate export/type wiring on disk.
7. Optionally roll up declarations.
8. Optionally update `package.json`.
9. Return structured diagnostics and artifacts.

Milestone 1 implemented the executable emit and validation pieces of this pipeline.

Milestone 2 now implements the first bundle primitive, but the full semantic rollup story is still in progress.

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

Status: done.

Completed:

- load `tsconfig.json` through a TypeScript-compatible compiler adapter
- force declaration-oriented compiler options
- create a TypeScript program through the provided compiler adapter
- emit declaration files through TypeScript
- automatically load `typescript` when an explicit compiler adapter is not passed
- validate declared declaration targets on disk
- validate declared runtime targets on disk when requested
- validate declared declaration targets against the actual TypeScript emitted files
- validate pattern declaration targets when the filesystem host can list files
- report error-level diagnostics for broken executable pipeline stages
- add end-to-end emit tests with temporary fixture packages

## Milestone 2: bundle mode

Status: in progress.

Implemented:

- collect declaration bundle targets from discovered entrypoints
- read concrete `.d.ts`, `.d.mts`, and `.d.cts` entrypoint files
- inline local declaration imports and re-exports
- keep external imports intact
- detect bundle cycles
- report unresolved local declaration imports
- write bundled declaration output back to entrypoint declaration files
- expose `bundleTypeScriptDeclarations`
- run bundling from `emitTypeScriptDeclarations` when `rollup: true`

Remaining:

- semantic-safe rollup using a TypeScript symbol graph or a mature declaration bundling strategy
- remove internal/private exports
- normalize imports for complex namespace, type-only, and re-export cases
- bundled output per concrete entrypoint for pattern exports
- package metadata wiring after bundled output is finalized
- more fixture tests for ESM/CJS split declarations
- stable publish-time output suitable for diffs

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
- optionally run declaration bundling when package configuration requests it
- keep declaration-specific behavior out of the main build command

This keeps Dler as the orchestrator and Declar as the declaration pipeline.

## Tests

Just run all Declar tests:

```bash
bun test packages/declar
```
