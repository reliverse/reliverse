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

The host developer CLI in `apps/rse`.

It auto-loads workspace plugins matching:

```txt
@reliverse/*-rse-plugin
```

Examples:

```bash
bun apps/rse/src/cli.ts --help
bun apps/rse/src/cli.ts dler --help
bun apps/rse/src/cli.ts pm add zod --target packages/rempts --json
bun apps/rse/src/cli.ts escape --input README.md
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
  allowedPatterns: ["@reliverse/*-rse-plugin"],
}
```

That means installed workspace packages matching that pattern can contribute commands.

Optional global fallback plugins can also be configured in:

```txt
~/.reliverse/rempts/config.json
```

using the `clis.rse.plugins` list.

Current plugin packages include:

- `@reliverse/dler-rse-plugin`
- `@reliverse/pm-rse-plugin`
- `@reliverse/rempts-rse-plugin`
- `@reliverse/toolkit-rse-plugin`
- `@reliverse/os-rse-plugin`

The host plugin search is anchored to the CLI package (`apps/rse`) rather than the caller's shell cwd, so `bun rse` from the repo root still resolves the CLI's declared plugin dependencies predictably.

## Examples

```bash
bun apps/rse/src/cli.ts --help
bun apps/rse/src/cli.ts dler --help
bun apps/rse/src/cli.ts dler build --targets plugins/pm,plugins/dler,apps/rse
bun apps/rse/src/cli.ts pm add zod --target packages/rempts --json
bun apps/rse/src/cli.ts pm update typescript --json
bun apps/rse/src/cli.ts escape --input README.md
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
apps/rse/src/cli.ts
```

The current CLI metadata is:

- name: `rse`
- description: `Reliverse developer CLI that aggregates Rempts plugins`

## Related docs

- Root repo docs: [`../../README.md`](../../README.md)
- Rempts docs: [`../../packages/rempts/README.md`](../../packages/rempts/README.md)


## Relpack batch update example

When both `rse` and `relpack` are shipped as local zip updates, `rse` can run the relpack plugin update as one safe batch:

```bash
bun apps/rse/src/cli.ts relpack unpack './rse-*.zip' './relpack-*.zip' \
  -o ./apps/rse ./plugins/relpack \
  --overwrite-mode clean \
  --backup \
  --rollback-on-fail \
  --post-check-command 'bun test apps/rse plugins/relpack' \
  --delete-archive \
  --apply
```

`rse` anchors plugin discovery to the CLI package root, not the caller's shell directory, so `bun rse ...` from the monorepo root resolves workspace plugins predictably.
