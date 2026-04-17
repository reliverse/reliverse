# `@reliverse/rse`

`rse` is the Reliverse developer CLI.

It is the main host CLI for internal developer workflows in this monorepo and is built on top of [`@reliverse/rempts`](../../packages/rempts/README.md).

## What it does

`rse` aggregates file-based command trees from workspace plugins and exposes them as one CLI.

It is configured as an automation-first host CLI:

- default interaction mode is `never`
- commands are expected to work well for agents, scripts, and CI
- humans can opt into guided flows only when commands support them

Current command families include:

- `dler` - build and publish flows
- `pm` - package management helpers
- `escape` - file conversion helpers

## CLI architecture in one minute

Reliverse CLI work is centered around two pieces:

### `@reliverse/rempts`

A file-based CLI foundation.

- Local commands come from `src/cmds/**/cmd.ts`
- Plugins are also file-based and mounted from their own `src/cmds/**/cmd.ts`
- Command precedence is deterministic:
  - local commands win over plugins on the same exact node
  - earlier plugins win over later plugins on the same exact node
  - deeper subcommands can still merge in
  - ambiguous aliases that resolve to different canonical commands fail hard

### `@reliverse/rse`

The host developer CLI in `apps/cli`.

It auto-loads workspace plugins matching:

```txt
@reliverse/*-rse-plugin
```

Examples:

```bash
bun apps/cli/src/cli.ts --help
bun apps/cli/src/cli.ts dler --help
bun apps/cli/src/cli.ts pm add zod --target packages/rempts --dry-run --json
bun apps/cli/src/cli.ts escape --input README.md --dry-run
```

## Quick start

Install dependencies:

```bash
bun install
```

Useful commands:

```bash
bun run dev:cli
bun run rse --help
bun run reliverse:build
bun run reliverse:typecheck
bun run test
```

## How plugin loading works

`rse` enables Rempts host plugin loading with:

```ts
plugins: {
  supportPlugins: true,
  allowedPatterns: ["@reliverse/*-rse-plugin"],
}
```

That means installed workspace packages matching that pattern can contribute commands.

Current plugin packages include:

- `@reliverse/dler-rse-plugin`
- `@reliverse/pm-rse-plugin`
- `@reliverse/tools-rse-plugin`
- `@reliverse/os-rse-plugin`

## Examples

```bash
bun apps/cli/src/cli.ts --help
bun apps/cli/src/cli.ts dler --help
bun apps/cli/src/cli.ts dler build --targets plugins/pm,plugins/dler,apps/cli --dry-run
bun apps/cli/src/cli.ts pm add zod --target packages/rempts --dry-run --json
bun apps/cli/src/cli.ts pm update typescript --dry-run --json
bun apps/cli/src/cli.ts escape --input README.md --dry-run
```

If you prefer package scripts:

```bash
bun run dev:cli
bun run rse --help
```

If a future command explicitly supports human-guided interaction, the host-side opt-in surface is:

```bash
bun run rse --interactive ...
bun run rse --tui ...
```

## Command model

`rse` itself is a Rempts host CLI.

So command resolution follows the same rules as `rempts`:

- local commands win over plugins on the same exact node
- earlier plugins win over later plugins on the same exact node
- deeper subcommands can still merge in
- ambiguous alias-to-different-canonical-name is a hard error

This lets `rse` combine local command scopes with plugin-provided deeper trees in a predictable way.

## Entry point

Main entry file:

```txt
apps/cli/src/cli.ts
```

The current CLI metadata is:

- name: `rse`
- description: `CLI for automating developer and sysadmin routine tasks.`

## Related docs

- Root repo docs: [`../../README.md`](../../README.md)
- Rempts docs: [`../../packages/rempts/README.md`](../../packages/rempts/README.md)
