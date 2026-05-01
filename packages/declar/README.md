# @reliverse/declar

Declaration tooling for TypeScript packages.

Declar helps a build tool answer one boring but important question:

> "Do the declaration files I emit actually match what my package exports?"

It does not replace TypeScript. It uses TypeScript for declaration emit, then adds package-aware checks around `package.json#exports`, `types` conditions, emitted files, and optional declaration bundling.

Declar is currently an early library used by Reliverse tooling. `dler build` is expected to use it as the declaration layer instead of keeping declaration-specific logic inside the build command.

## What it does

Declar can:

- read public entrypoints from `package.json#exports`
- understand common `types`, `import`, `require`, `default`, and `types@...` export shapes
- load `tsconfig.json` through a TypeScript-compatible compiler adapter
- emit `.d.ts` files through TypeScript
- verify that declared type targets exist on disk
- verify that TypeScript actually emitted the declared type targets
- report structured diagnostics for build tools
- optionally inline simple local `.d.ts` imports/re-exports with `rollup: true`
- optionally strip declarations marked with `@internal` or `@private` during bundling
- entrypoint discovery and planning
- TypeScript-backed declaration emit
- emitted-file validation
- filesystem-aware package target validation
- structured diagnostics
- optional early declaration bundling
- deterministic bundle target ordering
- opt-in text-level stripping for `@internal` / `@private` declarations
- pattern declaration target expansion to concrete bundle outputs
- external import/re-export dedupe
- identical declaration block dedupe
- unsafe declaration name collision diagnostics
- TypeScript-backed bundled output validation
- conservative opt-in package type metadata wiring

Declar does not / does not yet:

- rewrite `package.json` unless `updatePackageJson: true` or `wireDeclarPackageTypes({ write: true })` is used
- provide an API Extractor-style semantic rollup
- make declaration bundling safe for every complex package shape
- replace TypeScript's type checker
- full TypeScript symbol-graph declaration rollup
- API Extractor-level trimming/release-tag analysis
- broader package metadata rewriting for unusual export shapes
- semantic-safe pattern-export bundling beyond filesystem expansion
- fast isolated declaration mode with explicit fallback to the TypeScript-backed path

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

Keep both places:

- `exports["."].types` is the modern entrypoint-aware type target
- top-level `types` acts as a compatibility fallback and package metadata signal for tools and registries such as npm

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

It only rewrites `package.json` when you explicitly opt in with `updatePackageJson: true`.

## Quick start: just inspect package exports

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

`updatePackageJson: true` adds the planned phase. In the executable emit flow, it also opts into package type metadata writing after successful emit/validation.

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

Bundle mode is intentionally opt-in. It is useful for simple local declaration graphs. It now has basic collision detection, output normalization, and a TypeScript-backed bundled-output check. It is still not a full TypeScript symbol-graph rollup.

## Optional: package type wiring

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
- failed tsconfig loading or TypeScript emit
- bundle read/write/resolve errors
- unsafe bundle declaration name collisions
- bundled declaration output that TypeScript cannot check
- unsupported package metadata wiring shapes
- package metadata write failures

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

Main types are exported from the package too, including `DeclarDiagnostic`, `DeclarEntrypoint`, `DeclarPipelinePlan`, declaration bundle types, tsconfig adapter types, and TypeScript emit adapter/result types.

## Tests

```bash
bun test packages/declar
```
