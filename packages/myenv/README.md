# `@reliverse/myenv`

Compact, conservative runtime and terminal capability detection for Bun, Node, Deno, browsers, and worker-like environments.

## What it detects

- runtime: `bun`, `node`, `deno`, `browser`, `worker`, `unknown`
- execution context: `server`, `browser-main`, `web-worker`, `unknown`
- platform when it can be known safely
- process availability
- TTY support for `stdout` and `stderr`
- color support level for `stdout` and `stderr`
- compact env hints like CI, `NO_COLOR`, `FORCE_COLOR`, `NODE_DISABLE_COLORS`, and basic CLI color flags

## Core API

```ts
import {
  detectRuntime,
  detectExecutionContext,
  detectPlatform,
  detectColorSupport,
  detectTerminalSupport,
  getEnvHints,
  getMyEnv,
  isCI,
  isTTY,
} from "@reliverse/myenv";
```

## Example

```ts
const env = getMyEnv();

console.log(env.runtime);
console.log(env.executionContext);
console.log(env.terminal.stdout.level);
```

## Color support precedence

`detectColorSupport()` resolves color support in this order:

1. explicit override via `explicitColor`
2. CLI flags like `--color`, `--color=256`, `--color=truecolor`, `--no-color`
3. env vars like `FORCE_COLOR`, `NO_COLOR`, `NODE_DISABLE_COLORS`
4. native stream capabilities (`getColorDepth`, `hasColors`, `isTTY`)
5. conservative fallback, including a minimal CI fallback when nothing else is known

## `getMyEnv()` shape

`getMyEnv()` returns a normalized snapshot:

```ts
{
  runtime,
  executionContext,
  platform,
  hasProcess,
  hints,
  terminal: {
    stdout: { isTTY, level },
    stderr: { isTTY, level }
  }
}
```

Default calls are memoized. Use `clearMyEnvCache()` in tests if you need a fresh snapshot.

## Guarantees

- conservative detection over aggressive guessing
- safe access to globals and process-like objects
- no import-time crashes when globals are missing
- side-effect-free public API

## Non-goals

- deep browser UA sniffing
- noisy CI heuristics
- advanced terminal branding heuristics
- kitchen-sink environment introspection
