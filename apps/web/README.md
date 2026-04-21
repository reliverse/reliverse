# `@repo/reliverse-web`

Main web app for Reliverse.

## Purpose

This app provides the primary browser-based product surface for the monorepo.

It is the place where shared frontend packages come together, such as:

- `@repo/tailwind`
- `@repo/ui`
- `@repo/blocks`

## Stack

- TanStack Start / TanStack Router
- React
- Tailwind CSS
- Bun-first monorepo workflows

## Scripts

```bash
bun run dev
bun run build
bun run test
```

## Notes

- Routes are file-based
- Shared styling should prefer the workspace Tailwind package
- Shared contracts and integrations should prefer workspace packages over app-local duplication
