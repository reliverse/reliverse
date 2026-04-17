# `@repo/reliverse-mobile`

Expo-based mobile app for Reliverse.

## Purpose

This app provides the mobile client surface and integrates shared workspace packages such as:

- `@repo/env`
- `@repo/tailwind`
- `@repo/ui`

## Scripts

```bash
bun run dev
bun run android
bun run ios
bun run typecheck
bun run doctor
bun run prebuild
bun run prebuild:clean
bun run build:local
bun run build:cloud
```

## Notes

- Expo Router entrypoint
- React Native + Expo stack
- Local and cloud EAS build flows are both present
