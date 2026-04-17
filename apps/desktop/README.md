# `@repo/reliverse-desktop`

Desktop app shell for Reliverse.

## Purpose

This app provides the desktop runtime surface for Reliverse using an Electrobun-based stack.

## Stack

- Electrobun
- React
- Vite
- Tailwind CSS

## Scripts

```bash
bun run dev
bun run dev:hmr
bun run build
bun run build:prod
```

## Notes

- `dev:hmr` is the preferred local workflow when frontend iteration speed matters
- Desktop-specific window/runtime behavior should stay in the Bun-side entrypoints
- Shared UI and business logic should prefer workspace packages where practical
