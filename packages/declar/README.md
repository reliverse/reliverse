# `@reliverse/declar`

Declaration safety tooling for TypeScript packages.

Declar helps build tools answer one boring but important question:

> Do the declaration files I emit actually match what my package exports?

It does **not** replace TypeScript. TypeScript remains the source of truth for declaration emit. Declar adds the package-publishing layer around it: entrypoint discovery, export/type validation, emitted-file checks, optional declaration bundling, and conservative package type metadata wiring.

```txt
package.json exports
  -> entrypoint discovery
  -> TypeScript declaration emit
  -> emitted-file validation
  -> package target validation
  -> optional declaration bundling
  -> optional package type metadata wiring
```

Declar is currently an early library used by Reliverse tooling. `dler build` is expected to use it as the declaration layer instead of keeping declaration-specific logic inside the build command.

## Scope

### What Declar can do

- discover public entrypoints from `package.json#exports`
- understand common `types`, `import`, `require`, `default`, and `types@...` export shapes
- load `tsconfig.json` through a TypeScript-compatible compiler adapter
- emit `.d.ts` files through TypeScript
- validate declared declaration targets on disk
- validate that exported declaration targets were emitted by the current TypeScript run
- plan declaration pipeline phases without executing them
- report structured diagnostics for build tools
- optionally bundle simple local declaration graphs with `rollup: true`
- optionally strip declarations marked with `@internal` or `@private` during bundling
- expand pattern declaration targets into concrete bundle outputs
- dedupe external import/re-export lines and identical declaration blocks
- report unsafe declaration name collisions
- validate bundled output with TypeScript
- conservatively wire package type metadata when explicitly opted in

### Declar does not / Does not yet

- replace TypeScript's type checker
- provide an API Extractor-style semantic symbol-graph rollup
- make declaration bundling safe for every complex package shape
- perform API Extractor-level trimming or release-tag analysis
- broadly rewrite unusual export shapes
- rewrite `package.json` unless explicitly opted in
- provide fast isolated declaration mode with fallback to the TypeScript-backed path

## Install

```bash
bun add @reliverse/declar typescript
```

`typescript` is an optional peer dependency. Pass it explicitly when you can; otherwise Declar tries to load it from the runtime environment.

```ts
import ts from "typescript";
```

## Recommended package shape

For published packages, point exports at built files in `dist`, not raw source files:

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

Keep both type metadata locations:

- `exports["."].types` is the modern entrypoint-aware declaration target
- top-level `types` is a compatibility fallback and package metadata signal for tools and registries

Put `types` first in each export object. TypeScript checks conditions in order, and this avoids subtle package-resolution surprises.

## Quick start: emit and validate declarations

```ts
import { emitTypeScriptDeclarations } from "@reliverse/declar";
import ts from "typescript";

const packageJson = {
  exports: {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    },
  },
};

const result = await emitTypeScriptDeclarations({
  packageDir: process.cwd(),
  packageJson,
  compiler: ts,
  outDir: "dist",
  tsconfigPath: "tsconfig.json",
});

if (result.diagnostics.length > 0) {
  console.log(result.diagnostics);
}

console.log(result.emittedFiles);
```

The emit flow:

1. loads `tsconfig.json`
2. forces declaration-oriented compiler options
3. runs TypeScript with `emitDeclarationOnly`
4. discovers package entrypoints from `package.json#exports`
5. checks that exported declaration targets were emitted
6. checks that declaration targets exist on disk
7. optionally bundles declarations when `rollup: true`
8. checks bundled declaration output with TypeScript by default
9. optionally writes package type metadata when `updatePackageJson: true`

Declar only rewrites `package.json` when you explicitly opt in with `updatePackageJson: true`.

## Quick start: inspect package exports

Use this when a build tool only needs to understand the public type surface:

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

Each entrypoint includes:

- `exportPath` like `"."`, `"./cli"`, or `"./*"`
- `kind`: `"root"`, `"subpath"`, or `"pattern"`
- runtime targets such as `importPath`, `requirePath`, or `defaultPath`
- declaration targets such as `typesPath`, `importTypesPath`, or `requireTypesPath`
- normalized `runtimeConditions` and `typesConditions`

## Planning without executing

`createDeclarPipelinePlan` describes what Declar would do. It does not run TypeScript or write files.

```ts
import { createDeclarPipelinePlan } from "@reliverse/declar";

const plan = createDeclarPipelinePlan({
  packageDir: process.cwd(),
  packageJson,
  outDir: "dist",
  declarationMap: true,
  rollup: false,
  updatePackageJson: false,
});

console.log(plan.phases);
console.log(plan.diagnostics);
```

Possible phases are:

- `read-tsconfig`
- `discover-entrypoints`
- `typescript-declaration-emit`
- `validate-package-types`
- `bundle-declarations` when `rollup: true`
- `wire-package-types` when `updatePackageJson: true`
- `warn`

`updatePackageJson: true` adds the planned phase. In the executable emit flow, it also opts into package type metadata writing after successful emit, validation, and optional bundling.

## Optional: declaration bundling

Declar has an early bundling primitive for simple declaration graphs.

```ts
import { bundleTypeScriptDeclarations, discoverPackageEntrypoints } from "@reliverse/declar";

const discovery = discoverPackageEntrypoints(packageJson);

const result = await bundleTypeScriptDeclarations({
  packageDir: process.cwd(),
  entrypoints: discovery.entrypoints,
  write: false,
});

console.log(result.bundles);
console.log(result.diagnostics);
```

The bundler:

- starts from concrete `types` targets
- reads `.d.ts`, `.d.mts`, and `.d.cts` files
- inlines local declaration imports and re-exports
- keeps external package imports untouched
- deduplicates external import/re-export lines
- deduplicates identical declaration blocks
- reports unsafe type/class/value declaration name collisions
- strips declaration source map comments
- can remove declarations marked with `@internal` or `@private` when `stripInternal: true`
- expands pattern targets like `./dist/*.d.ts` to concrete files when the host can list files
- writes back to the entrypoint file by default

Use `write: false` to preview output. Use `banner: false` to skip the generated banner. Use `stripInternal: true` to remove declarations whose JSDoc contains `@internal` or `@private`.

Bundle mode is intentionally opt-in. It is useful for simple local declaration graphs. It includes basic collision detection, output normalization, and a TypeScript-backed bundled-output check. It is still not a full TypeScript symbol-graph rollup.

## Optional: package type metadata wiring

Use `wireDeclarPackageTypes` when you want Declar to update package type metadata from discovered entrypoints.

```ts
import { discoverPackageEntrypoints, wireDeclarPackageTypes } from "@reliverse/declar";

const discovery = discoverPackageEntrypoints(packageJson);

const result = await wireDeclarPackageTypes({
  packageJson,
  entrypoints: discovery.entrypoints,
  packageDir: process.cwd(),
  write: true,
});

console.log(result.packageJson);
console.log(result.diagnostics);
```

The wiring helper is conservative:

- sets top-level `types` from the root entrypoint
- wires object export entries with `types` / `types@...` conditions
- wires nested `import.types` and `require.types` conditions
- reports unsupported string or unusual export entries instead of reshaping them silently
- writes only when `write: true`

`emitTypeScriptDeclarations({ updatePackageJson: true })` uses this helper after successful emit, validation, and optional bundling.

## Validation helpers

Validate declared files on disk:

```ts
import { discoverPackageEntrypoints, validateDeclarEntrypointFiles } from "@reliverse/declar";

const discovery = discoverPackageEntrypoints(packageJson);

const validation = await validateDeclarEntrypointFiles({
  packageDir: process.cwd(),
  entrypoints: discovery.entrypoints,
  checkRuntimeTargets: false,
});

console.log(validation.diagnostics);
```

Validate emitted files against package exports:

```ts
import { validateDeclarEmittedFiles } from "@reliverse/declar";

const validation = validateDeclarEmittedFiles({
  packageDir: process.cwd(),
  entrypoints: discovery.entrypoints,
  emittedFiles: ["/repo/packages/example/dist/index.d.ts"],
});

console.log(validation.diagnostics);
```

This catches stale `dist` files: a declaration file may exist, but the current TypeScript run may not have emitted it.

## Supported export shapes

### Root export

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

### Subpath export

```json
{
  "exports": {
    "./cli": {
      "types": "./dist/cli.d.ts",
      "import": "./dist/cli.js"
    }
  }
}
```

### ESM/CJS split declarations

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

### Versioned TypeScript types

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

Pattern targets can be discovered, validated, and expanded into concrete declaration bundle outputs when the filesystem host can list files.

## Diagnostics

Declar returns structured diagnostics instead of printing directly:

```ts
export interface DeclarDiagnostic {
  readonly code: DeclarDiagnosticCode;
  readonly message: string;
  readonly path?: readonly string[];
  readonly severity: "error" | "info" | "warning";
}
```

Useful helpers:

```ts
import {
  createDeclarDiagnostic,
  createDeclarError,
  createDeclarWarning,
  hasDeclarErrors,
} from "@reliverse/declar";
```

Common diagnostics include:

- missing `types` conditions in exports
- unsupported export shapes
- export targets outside the package directory
- declaration files missing on disk
- declaration targets not emitted by TypeScript
- failed `tsconfig.json` loading
- failed TypeScript declaration emit
- bundle read/write/resolve errors
- unsafe bundle declaration name collisions
- bundled declaration output that TypeScript cannot check
- unsupported package metadata wiring shapes
- package metadata write failures

A build tool can turn these diagnostics into user-facing output, for example:

```txt
@reliverse/declar found 2 declaration issues:

error DECLAR_MISSING_EXPORTED_TYPES
  exports["./cli"].types points to ./dist/cli.d.ts,
  but the current TypeScript emit did not produce that file.

warning DECLAR_TOP_LEVEL_TYPES_MISMATCH
  package.json#types points to ./dist/index.d.ts,
  but exports["."].types points to ./dist/main.d.ts.
```

## Public API

Main functions:

- `discoverPackageEntrypoints(packageJson)`
- `createDeclarPipelinePlan(options)`
- `loadDeclarTsconfig(options)`
- `emitTypeScriptDeclarations(options)`
- `wireDeclarPackageTypes(options)`
- `validateDeclarEntrypointFiles(options)`
- `validateDeclarEmittedFiles(options)`
- `collectDeclarConditionPaths(entrypoints)`
- `collectDeclarDeclarationBundleTargets(entrypoints)`
- `bundleTypeScriptDeclarations(options)`

Main types are exported from the package too, including:

- `DeclarDiagnostic`
- `DeclarEntrypoint`
- `DeclarPipelinePlan`
- declaration bundle types
- tsconfig adapter types
- TypeScript emit adapter/result types

## Tests

```bash
bun test packages/declar
```
