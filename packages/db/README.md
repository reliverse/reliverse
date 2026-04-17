# `@repo/db`

Shared database package for Reliverse.

## Purpose

Provides schema, DB access helpers, and Drizzle-based database workflows.

## Scripts

```bash
bun run db
bun run db:push
bun run db:generate
bun run db:studio
bun run db:migrate
bun run auth:generate
```

## Notes

- Drizzle-based package
- Exposes `./schema` exports
- Depends on `@repo/env`
