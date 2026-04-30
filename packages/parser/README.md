# `@reliverse/parser`

Pure argument parser core for Reliverse CLIs.

`@reliverse/parser` owns the side-effect-free part of CLI argument handling:

```txt
argv + option schema + env -> typed options + positional args
```

It does not discover commands, load plugins, prompt users, write output, render full CLI help, or execute handlers. Those runtime concerns belong to `@reliverse/rempts`.

## Features

- long options: `--output`, `--config`
- short aliases: `-o`, `-c`
- inline values: `--output=file.txt`
- separated values: `--output file.txt`
- boolean flags: `--verbose`
- negatable booleans: `--no-install`
- explicit boolean values: `--install=false`
- string, number, and boolean coercion
- default values
- env-backed values
- option input-source restrictions: `flag`, `env`, `default`, `stdin`
- strict unknown-option errors
- `--` positional delimiter
- required value errors when the next token is another option
- duplicate scalar option errors instead of silent last-write-wins
- typed option output
- validation through Standard Schema-compatible schemas
- structured parser errors: `ParserUsageError`, `ParserValidationError`
- unit tests for parser behavior

## Public API

```ts
import { parseArgvTail, type CommandOptionsRecord } from "@reliverse/parser";

const options = {
  apply: { type: "boolean", defaultValue: false },
  target: { type: "string", short: "t" },
} as const satisfies CommandOptionsRecord;

const parsed = await parseArgvTail(["--target", "apps/web", "--apply"], options);

// parsed.args -> []
// parsed.options -> { target: "apps/web", apply: true }
```

## Package boundary

Parser owns pure parsing primitives:

- argv token parsing
- option schema types
- flag-name normalization
- value coercion
- option validation
- parser diagnostics/errors
- parse-only APIs for tests, editors, agents, and integrations

Everything that requires a command tree, host CLI, filesystem discovery, plugins, prompting, output rendering, safety policy, or execution belongs outside this package.

## Near-term roadmap

- [ ] Add token-level parse metadata: raw token, normalized name, index, source.
- [ ] Add explicit positional argument schema support.
- [ ] Add enum/choice options with clear diagnostics.
- [ ] Add repeated/array options without weakening duplicate scalar errors.
- [ ] Add parser-level JSON diagnostic contract.
- [ ] Add fuzz/property tests for unusual argv combinations.

## Design rules

- Pure by default: no process exit, no stdout/stderr writes, no command execution.
- Schema-first: one typed option definition should drive parsing, validation, and parser metadata.
- Strict automation behavior: ambiguous input should fail loudly.
