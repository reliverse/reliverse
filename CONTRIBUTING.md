# Contributing to Reliverse

Thanks for contributing.

Reliverse is now a focused monorepo for:
- developer tooling
- the `rse` CLI and its plugins
- reusable UI packages
- the web presence and docs for those tools

User-facing product flows, auth, API, billing, and social features were intentionally moved out of this repo.

## Tooling

Core tools:
- Bun
- TypeScript
- Turborepo

## Documentation

Docs live in `apps/wiki/` and are published at <https://wiki.reliverse.org/docs>.

If your change affects behavior, configuration, UX, or public APIs, update the relevant docs.

## Architecture Overview

```bash
apps/       → deployable surfaces (web, wiki, cli)
packages/   → reusable packages (UI, blocks, rempts, reliverse libs)
plugins/    → RSE plugins such as build/publish and package-management helpers
scripts/    → automation helpers
```

General direction:
- apps can depend on packages
- packages should not depend on apps
- plugins should stay automation-friendly and dry-run-first when possible
- Reliverse stays tool-first, not product-backend-first

## Testing

Run all tests:

```bash
bun test
```

Or run a specific workspace or file set:

```bash
bun test plugins/dler
```

Before opening a PR:
- ensure the relevant build works
- ensure TypeScript compiles cleanly
- ensure tests pass where applicable

## Folder Structure

### Apps
- `apps/cli` - `rse`, the Reliverse developer CLI
- `apps/web` - marketing site and tool landing pages
- `apps/wiki` - docs and blog surface

### Packages
- `packages/rempts` - Bun-first file-based CLI foundation
- `packages/relico` - terminal color helpers
- `packages/myenv` - env helpers
- `packages/tailwind` - shared design preset
- `packages/tsconfig` - shared TS config
- `packages/ui` - UI primitives
- `packages/ui-utils` - small shared UI utilities
- `packages/blocks` - higher-level web blocks

### Plugins
- `plugins/dler` - build and publish flows
- `plugins/pm` - package-management helpers
- `plugins/tools` - file conversion helpers such as `escape`
- `plugins/os` - OS automation commands
- `plugins/agent` - agent-related CLI extensions

## Reporting Issues

Helpful issue reports include:
- steps to reproduce
- logs or screenshots
- environment details
- expected vs actual behavior

## Security

If you discover a vulnerability, follow the responsible disclosure guidance in `SECURITY.md`.
