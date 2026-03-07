---
name: workflow-repo
---

# Repository Workflow

## Build Commands

- `bun build`: Only for build/bundler issues or verifying production output
- `bun lint`: Type-checking & type-aware linting
- `bun dev` runs indefinitely in watch mode
- `bun db` for Drizzle Kit commands (e.g. `bun db generate` to generate a migration)

Don't build after every change. If lint passes; assume changes work.

## Testing

No testing framework is currently set up. Prefer lint checks for now.

## Formatting

Oxfmt is configured for consistent code formatting via `bun format`. It runs automatically on commit via Husky pre-commit hooks, so manual formatting is not necessary.
