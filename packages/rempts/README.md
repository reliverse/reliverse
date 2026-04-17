# `@reliverse/rempts`

`@reliverse/rempts` is a Bun-first, file-based CLI foundation for TypeScript projects.

It is designed for CLIs that should stay:

- explicit
- automation-friendly
- composable
- easy to reason about

## Core idea

Rempts treats command trees as filesystem structure.

Local commands live under a CLI's own `cmds/` tree.
Plugin commands also live under their own `cmds/` tree.

That means the same discovery model works for both:

- host CLI commands
- plugin-provided commands

## Quick start

### Local file-based CLI

```ts
import { createCLI } from "@reliverse/rempts";

await createCLI({
  entry: import.meta.url,
  meta: {
    description: "My automation-friendly CLI",
    name: "my-cli",
  },
  help: {
    examples: ["my-cli sync --dry-run"],
    format: "auto",
  },
});
```

### Command module

```ts
import { defineCommand } from "@reliverse/rempts";

export default defineCommand({
  meta: {
    description: "Example command",
  },
  agent: {
    notes: "Prefer flags first. Use stdin only when the caller opts into it explicitly.",
  },
  conventions: {
    acceptsStdin: ["flag", "stdin"],
    idempotent: true,
    supportsDryRun: true,
    supportsApply: true,
  },
  options: {
    dryRun: {
      type: "boolean",
      description: "Preview changes without writing",
      inputSources: ["flag"],
    },
    text: {
      type: "string",
      description: "Direct text input",
      inputSources: ["flag"],
    },
    stdin: {
      type: "boolean",
      description: "Read explicit piped input",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    const value = ctx.options.stdin ? await ctx.input.text() : ctx.options.text;

    if (!value) {
      ctx.exit(1, 'Missing input. Pass --text "..." or pipe data with --stdin.');
    }

    if (ctx.output.mode === "json") {
      ctx.output.result({ source: ctx.options.stdin ? "stdin" : "flag", value }, "example");
      return;
    }

    ctx.out(value);
  },
});
```

### File-based plugin

```ts
import { definePlugin } from "@reliverse/rempts";

export default definePlugin({
  entry: import.meta.url,
  name: "builder-plugin",
  description: "Builder plugin for my CLI",
});
```

## Directory layout

### Host CLI

```txt
src/
  cli.ts
  cmds/
    hello/
      cmd.ts
```

With this layout:

```bash
my-cli hello
```

### Plugin

```txt
src/
  index.ts
  cmds/
    dler/
      build/
        cmd.ts
      pub/
        cmd.ts
```

With this layout, the host CLI can expose:

```bash
my-cli dler build
my-cli dler pub
```

If you want:

```bash
my-cli dler
```

then add:

```txt
src/
  cmds/
    dler/
      cmd.ts
```

## How discovery works

Rempts resolves the runtime tree from `entry`:

- `.ts` entry files use `cmd.ts`
- `.js` entry files use `cmd.js`
- the discovered command root is the sibling `cmds/` directory
- directories without `cmd.ts` or `cmd.js` can still act as intermediate scope containers for deeper subcommands

This is important because it enables trees like:

```txt
cmds/
  dler/
    pub/
      jsr/
        cmd.ts
```

Even if `cmds/dler/pub/cmd.ts` does not exist.

## Plugin model

`definePlugin(...)` is intentionally small.

```ts
export default definePlugin({
  entry: import.meta.url,
  name: "my-plugin",
  description: "Optional human-facing description",
});
```

### Plugin fields

- `entry` - path or file URL to the plugin entry module
- `name` - internal plugin identifier
- `description` - optional help text used when the plugin contributes a top-level scope without its own `cmd.ts`

### Important note about `name`

`plugin.name` does **not** define command paths.

Commands come only from the plugin's `cmds/` tree.

For example:

- `name: "builder-plugin"` is internal only
- `cmds/dler/build/cmd.ts` still becomes `dler build`

## Command precedence and merging

Rempts supports multiple command sources at once:

- the host CLI's local file-based commands
- plugin command trees

The merge behavior is deterministic:

- local commands win over plugins on the same exact node
- earlier plugins win over later plugins on the same exact node
- deeper subcommands can still merge in from later plugins
- ambiguous alias-to-different-canonical-name is a hard error

This lets you safely compose trees such as:

- local CLI provides `dler`
- plugin A provides `dler/build` and `dler/pub`
- plugin B provides `dler/build/native-binary`, `dler/pub/jsr`, and `dler/pack`

Result:

```bash
my-cli dler build
my-cli dler build native-binary
my-cli dler pub
my-cli dler pub jsr
my-cli dler pack
```

## Runtime behavior

- root help and command help are built from structured metadata
- `--help --json` emits machine-readable help
- reserved global flags are separate from final-command flags
- non-TTY mode is fail-fast for missing interactive input
- prompts are fallback UX, not the main automation path
- `ctx.input.text()` and `ctx.input.json()` are explicit stdin primitives
- `ctx.output.result(...)` is the preferred JSON success path
- structured errors are emitted with stable `kind`, `code`, `message`, and optional `issues`

## Command author guidance

- Prefer idempotent commands when reasonable
- Add `--dry-run` for side-effecting commands
- Use `--apply` when a command should switch from preview to real execution
- Prefer clearer flags such as `--overwrite` when the behavior is specifically about replacing existing outputs
- Use `--yes` only when a command actually has a confirmation step
- Include examples in `--help` for meaningful commands
- Keep stdin support explicit
- Prefer flags first, then explicit stdin helpers, then defaults, then prompts
- In JSON mode, return machine-followable data such as ids, paths, counts, and plans

TTY prompts fall back to plain text automatically, and non-TTY environments stay non-interactive.
