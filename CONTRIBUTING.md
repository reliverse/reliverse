# Contributing to Reliverse

Reliverse is a modular ecosystem built with clarity, consent, and long-term sustainability in mind. It's evolving, so every thoughtful contribution helps move it forward. To contribute, you don't need a technical background here. If you care about the ideas behind Reliverse, you already belong here. Thank you for being here.

## Ways to Contribute

There are many ways to participate. Code is just one of them. You can:

- Support the project via [GitHub Sponsors](https://github.com/sponsors/blefnk)
- Report bugs or suggest improvements
- Improve documentation or tests
- Improve accessibility or UX/UI
- Refactor for clarity
- Review pull requests

You can also:

- Write blog posts
- Create videos or tutorials
- Share thoughtful criticism
- Start discussions about architecture or philosophy
- Talk about Reliverse on social platforms (for example on [Bleverse](https://bleverse.com))

Clear thinking and honest feedback are always welcome.

## The Spirit of the Project

Reliverse is built around a few guiding values:

- Calm by default
- Explicit over implicit
- Stable at the boundaries
- Respectful of user sovereignty
- Modular over tightly coupled systems

They help us make consistent decisions as the platform evolves.

If something feels unclear, starting a discussion is always welcome.

## Before You Start

A few gentle guidelines:

- Be kind and constructive.
- Small, focused changes are easier to review.
- If you're planning something large or structural, opening an issue first can help align expectations.

There's no rush. Thoughtful progress is better than fast progress.

## About Larger Changes

Some parts of Reliverse influence the platform at a structural level, such as:

- Core architecture
- Authentication
- SDK contracts
- Entitlements
- Data models
- Public APIs
- Billing

Changes in these areas can ripple across the system. Starting a conversation early helps us explore implications together and keep the ecosystem coherent.

This isn't about gatekeeping. It's about shared responsibility for long-term stability.

## Project Status

> **v0.x**: Reliverse is evolving.

Some APIs and internal structures are still stabilizing as the platform matures.

Breaking changes are documented in `CHANGELOG.md`.

## Development Setup

1. Fork this repo
2. **Clone your fork**
3. Install dependencies
4. Run the appropriate dev command

```bash
git clone https://github.com/your-username/reliverse.git
cd reliverse
bun install
bun dev:web
```

Exact commands may vary by workspace. To learn more, please check the nearest `package.json` or documentation.

**Some of the tools Reliverse uses**:

- Bun (runtime, package manager, test runner)
- TypeScript (strict mode)

## Documentation

Documentation lives at [https://wiki.reliverse.org/docs](https://wiki.reliverse.org/docs)

If your change affects behavior, configuration, UX, or public APIs, please update the relevant documentation so others can understand and build on your work.

## Architecture Overview

Reliverse is organized as a modular monorepo:

```bash
apps/          → deployable runtimes
wiki/          → deployable docs and blog
packages/      → reusable platform modules
scripts/       → automation tools
components/    → UI libraries
```

We try to keep boundaries clear so the system remains maintainable as it grows.

General direction:

- Apps depend on packages.
- Packages don't depend on apps.
- Public APIs stay typed and documented.
- SDK remains independent from server internals.

These boundaries exist to reduce future friction.

## Code Style

There's no obsession with cleverness.

- Avoid unnecessary abstractions.
- Add dependencies thoughtfully.
- Prefer clarity over tricks.
- Keep functions focused.

If something feels uncertain, starting a discussion is completely fine.

## Testing

Run all tests:

```bash
bun test
```

Or filter by workspace:

```bash
bun test --filter packages/sdk
```

Before opening a PR:

- Ensure the project builds
- Ensure TypeScript compiles cleanly
- Ensure tests pass (if applicable)

## Pull Requests

When opening a PR, consider including:

- What changed
- Why it changed
- Screenshots (for UI updates)
- Notes about breaking changes

Well-scoped PRs are easier to understand and collaborate on.

## If Something Is Declined

Not every contribution will be merged, and that's okay.

Sometimes changes may conflict with long-term architectural direction or introduce complexity that isn't aligned with current goals.

If something doesn't move forward, it's never personal. Open source works best when clarity and respect are maintained on both sides.

## Reporting Issues

When reporting an issue, the more context you can share, the better. Helpful details may include:

- Steps to reproduce
- Logs or screenshots
- Your environment details
- Expected vs actual behavior

Clear reports make it easier for everyone to understand what's happening and work toward a fix.

## Security

If you discover a security vulnerability, please do not disclose it publicly.

Instead, follow the responsible disclosure process outlined in [SECURITY.md](SECURITY.md) file.

## Final Note

Reliverse is evolving, intentionally and carefully.

The priority is long-term stability over rapid growth.

If you're here, you're part of that effort. And that matters.
