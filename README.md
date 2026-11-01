# Reliverse

Reliverse is an open-source ecosystem of tools for building and operating modern software systems without unnecessary complexity.

> **Clear by design. Modular by architecture.**

Built for clarity and long-term maintainability.

## What is Reliverse

Reliverse is not just a tooling monorepo. It is:

- A modular ecosystem of developer-first tools
- A Bun and TypeScript infrastructure for modern systems
- A foundation for building maintainable developer ecosystems
- A reference implementation of transparent tooling architecture

Reliverse powers multiple systems, including parts of the Bleverse ecosystem.

## Design Goals

- Developer-first architecture
- Modules instead of monoliths
- Explicit system behavior
- Clear system boundaries
- Long-term maintainability
- Low cognitive overhead
- Consent-first automation

## Principles

- Modular by design
- Open by architecture
- Automation with explicit control
- System behavior must be understandable
- Tooling should reduce complexity, not hide it

## Philosophy

Reliverse tooling follows several guiding ideas:

- No dark patterns in developer tools
- Accessibility and clarity by default
- Consent precedes automation
- System actions are visible and reversible
- Configuration is explicit and developer-controlled

## Conventions

- Bun-first tooling
- TypeScript-first implementation
- Favor production-ready fixes over brittle patches
- Prefer explicit configuration over hidden behavior
- Prefer file-based command trees over large programmatic manifests

## Quick start

Use **Bun 1.4.4**, matching `packageManager` in the root manifest.

```sh
git clone https://github.com/reliverse/reliverse.git
cd reliverse
bun install --frozen-lockfile
bun run rse --help
bun run rse dler build --help
bun test scripts/bootstrap-smoke.test.ts
bun run test
```

The baseline checks cover installation, CLI discovery, and selected portable
packages. They do not execute builds, publish packages, deploy services, or
certify every plugin operation. See [CONTRIBUTING.md](./CONTRIBUTING.md) for
scoped validation.

## Public source scope

This checkout retains RSE, its plugins, the portable packages, and the web/wiki
source. Additional modern subsystems are published incrementally with their
complete dependencies; do not assume an unpublished CLI or package is available.
The absence of a subsystem in this release is not its deprecation.

Website and documentation development commands are `bun run dev:web` and
`bun run dev:docs`. Production builds and deployment have separate requirements;
installation and CLI help are not production acceptance. Deployment is an
explicit manual workflow, never a side effect of pushing source to `main`.

## Contributing

We welcome contributions ❤️

- Read [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Open an issue: <https://github.com/reliverse/reliverse/issues>
- Support development: <https://github.com/sponsors/blefnk>

If you discover a security issue, report it privately. See [`SECURITY.md`](./SECURITY.md).

## Wiki

- Docs: <https://wiki.reliverse.org/docs>
- Blog: <https://wiki.reliverse.org/blog>

## License

<https://github.com/reliverse/reliverse>

Copyright © 2026-present Nazarii Korniienko

Licensed under the [MIT License](./LICENSE). Some packages may define additional licenses in their own directories.
