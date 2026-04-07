# `@reliverse/rempts`

Bun-first, file-based CLI foundation for TypeScript projects.

## Quick Start

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

```ts
import { createCLI, definePlugin } from "@reliverse/rempts";

const builderPlugin = definePlugin({
  id: "builder",
  commands: [
    {
      description: "Builder command group",
      path: ["builder"],
    },
    {
      description: "Build workspaces",
      loadCommand: () => import("./plugins/builder-build").then((module) => module.default),
      path: ["builder", "build"],
    },
  ],
});

await createCLI({
  entry: import.meta.url,
  meta: { name: "my-cli" },
  plugins: { explicit: [builderPlugin] },
});
```

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
    supportsForce: true,
  },
  help: {
    // examples: ["my-cli example --dry-run"]
  },
  options: {
    dryRun: {
      type: "boolean",
      description: "Preview changes without writing",
      inputSources: ["flag"],
    },
    force: {
      type: "boolean",
      short: "f",
      description: "Force execution",
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

## Command Layout

```txt
src/
  cli.ts
  cmds/
    hello/
      cmd.ts
```

Rempts resolves the runtime tree from `entry`:

- `.ts` entry files load `cmd.ts`
- `.js` entry files load `cmd.js`
- the runtime stays inside the tree that contains the resolved `entry`
- host CLIs can extend the local `cmds/` tree with lazy plugin-provided command nodes

## Plugins

- Use `definePlugin(...)` to register additional command trees.
- Plugin commands participate in the same discovery, help, parsing, error, and output pipeline as local file-based commands.
- Plugin manifests stay lightweight; `loadCommand()` is called only when a leaf command needs full help or execution.
- Local file-based commands remain the default source, so plugin support extends the architecture instead of replacing it.

## Runtime Behavior

- root help and command help are built from structured help metadata
- `--help --json` emits a machine-readable help document with flags, examples, and subcommands
- reserved global flags are separate from final-command flags
- non-TTY mode is fail-fast for missing interactive input
- prompts are fallback UX, not the primary automation path
- `ctx.input.text()` and `ctx.input.json()` are the explicit stdin primitives
- `ctx.output.result(...)` is the preferred structured success path in JSON mode
- structured errors are emitted on stderr in JSON mode with stable `kind`, `code`, `message`, and optional `issues`
- plugin and local command collisions fail fast instead of resolving silently

## Command Author Guidance

- Prefer idempotent commands where reasonable.
- Add `--dry-run` for side-effecting commands.
- Use `--force` only for explicit overwrite/bypass semantics.
- Use `--yes` only when a command actually has a confirmation step.
- Every meaningful command should include examples in `--help`.
- Keep stdin support explicit. Do not silently consume piped input unless the command asked for it.
- Follow source precedence deliberately: flags first, then explicit stdin helpers, then defaults, then prompts.
- In JSON mode, return machine-followable data such as ids, paths, counts, and dry-run plans.

TTY prompts fall back to plain text automatically, and non-TTY environments stay non-interactive.
