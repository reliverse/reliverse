# `@reliverse/declar`

Declaration safety tooling for TypeScript packages.

Declar helps build tools answer one boring but important question:

> Do the declaration files I emit actually match what my package exports?

It does **not** replace TypeScript. TypeScript remains the source of truth for declaration emit. Declar adds the package-publishing layer around it: entrypoint discovery, export/type validation, emitted-file checks, optional declaration bundling, and conservative package type metadata wiring.

```txt
package.json exports
  -> entrypoint discovery
  -> TypeScript declaration emit, or opt-in fast isolated emit with TypeScript fallback
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
- optionally emit simple isolated declarations through TypeScript's `transpileDeclaration` fast path
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
- keep fast isolated declaration mode opt-in and inspectable through diagnostics

### Declar does not / Does not yet

- replace TypeScript's type checker
- provide an API Extractor-style semantic symbol-graph rollup
- make declaration bundling safe for every complex package shape
- perform API Extractor-level trimming or release-tag analysis
- broadly rewrite unusual export shapes
- rewrite `package.json` unless explicitly opted in
- make fast isolated declaration mode the default
- accept fast isolated output that failed Declar package/export validation

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
  files: ["./src/index.ts"],
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
3. runs TypeScript with `emitDeclarationOnly`, optionally limited to explicit `files`
4. discovers package entrypoints from `package.json#exports`
5. checks that exported declaration targets were emitted
6. checks that declaration targets exist on disk
7. optionally bundles declarations when `rollup: true`
8. checks bundled declaration output with TypeScript by default
9. optionally writes package type metadata when `updatePackageJson: true`

Declar only rewrites `package.json` when you explicitly opt in with `updatePackageJson: true`.

## Optional: fast isolated declaration emit

M3 adds an opt-in fast path for packages that satisfy TypeScript's `isolatedDeclarations` constraints.

```ts
const result = await emitTypeScriptDeclarations({
  packageDir: process.cwd(),
  packageJson,
  compiler: ts,
  fastDeclarations: true,
});
```

`fastDeclarations` accepts:

- `false` / omitted — use the TypeScript-backed declaration emit path only
- `true` or `"auto"` — try isolated declaration emit first, then fall back to TypeScript when unsafe
- `"typescript"` — explicit spelling for the TypeScript-backed mode

`fastDeclarationFallback` controls what happens when fast emit is unavailable or unsafe:

- `"typescript"` / omitted — report a warning diagnostic and continue through the TypeScript-backed path
- `"error"` — treat the fast-path failure as fatal and skip TypeScript fallback

The fast path uses TypeScript 5.5+ `transpileDeclaration`. It is intentionally conservative:

- source files must be `.ts`, `.tsx`, `.mts`, or `.cts` and not existing declaration files
- exported declarations must be explicit enough for isolated declaration emit
- unsupported syntax or TypeScript isolated-declaration diagnostics trigger fallback
- fast output is validated against package exports before Declar accepts it
- fast output is not written incrementally when Declar already knows it must fall back

Fast-path diagnostics are structured and user-facing:

- `DECLAR_FAST_PATH_USED`
- `DECLAR_FAST_PATH_SKIPPED`
- `DECLAR_FAST_PATH_FALLBACK`
- `DECLAR_FAST_PATH_UNSUPPORTED_SYNTAX`
- `DECLAR_FAST_PATH_INVALID_OUTPUT`
- `DECLAR_FAST_PATH_EMITTER_UNAVAILABLE`

Fast mode is **opt-in experimental complete** for M3. It is suitable for simple isolated packages, but TypeScript remains the correctness baseline.

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

## M4: declaration rollup strategy

M4 closes Declar's rollup direction: **do not build an API Extractor clone inside Declar by default**.

Declar now treats declaration rollup as three tiers:

1. **Keep declarations unbundled** — default recommendation. Per-entrypoint `.d.ts` files are easiest to reason about and safest for package publishing.
2. **Use Declar's current text-level bundler** — acceptable only for simple concrete declaration graphs, with `rollup: true` and TypeScript validation after bundling.
3. **Delegate semantic rollup** — recommended for complex package shapes such as pattern entrypoints, split import/require type surfaces, release-tag trimming, symbol graph normalization, or API Extractor-style output.

Build tools can inspect the default recommendation before choosing a rollup path:

```ts
import {
  assessDeclarDeclarationRollupStrategy,
  discoverPackageEntrypoints,
} from "@reliverse/declar";

const discovery = discoverPackageEntrypoints(packageJson);
const strategy = assessDeclarDeclarationRollupStrategy({
  entrypoints: discovery.entrypoints,
  preferBundledDeclarations: true,
});

console.log(strategy.recommendation);
console.log(strategy.risks);
```

Recommendations:

- `keep-unbundled-declarations`
- `use-current-text-bundler`
- `delegate-semantic-rollup`

Known risk flags include:

- `pattern-entrypoints`
- `split-import-require-types`
- `unknown-entrypoint-shape`

M4 is intentionally a strategy/API milestone, not a semantic rollup implementation milestone. The current bundler remains conservative, opt-in, and validation-backed.

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
- fast isolated declaration emit used, skipped, unavailable, unsafe, or invalid

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

## M3 exit criteria

M3 is closed as **opt-in experimental complete**:

- Declar can detect fast isolated declaration eligibility through TypeScript `transpileDeclaration` support and per-file isolated-declaration diagnostics.
- Declar can generate `.d.ts`, `.d.mts`, `.d.cts`, and declaration map outputs for supported simple files.
- Declar falls back to the TypeScript-backed emit path for unavailable emitters, unsupported syntax, invalid output, and package/export validation failures.
- Fast-path decisions are exposed through structured diagnostics.
- Fast-path output is validated against package exports before it is accepted.
- Existing TypeScript-backed behavior remains the correctness baseline.
- Fast mode remains opt-in and documented as experimental.

## Tests

```bash
bun test packages/declar
```
