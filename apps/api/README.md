# `@repo/reliverse-api`

Backend API runtime for Reliverse.

## Purpose

This app hosts the server-side API layer and composes shared workspace packages such as:

- `@repo/server`
- `@repo/auth`
- `@repo/db`
- `@repo/env`

## Scripts

```bash
bun run dev
bun run start
bun run build
bun run typecheck
bun run compile
bun run start:dist
```

## Notes

- Bun-first runtime
- Elysia-based server stack
- Intended to be consumed together with the rest of the monorepo platform
