---
name: code-standards
description: Engineering and architectural standards for the Bun + TypeScript + React monorepo.
license: MIT
---

# Code Standards

## Overview

This repository is a **Bun-based monorepo** written in **TypeScript (strict mode)** and managed via Bun workspaces.

The architecture strictly separates:

- **Deployable applications** (`apps/` & `documentation/`)
- **UI component libraries** (`components/`)
- **Reusable platform modules** (`packages/`)
- **Automation & scripts** (`scripts/`)

The system is designed to be calm, minimal, and intentionally structured.

## Core Values

- Simplicity over cleverness
- Remove accidental complexity first
- Minimal abstractions, minimal surface area
- Prefer omission over correction
- Explicit system boundaries
- Code must feel intentional and human
- No architectural drift

## Defaults

- Runtime & tooling: **Bun**
- Language: **TypeScript (strict mode)**
- No `any`
- No unsafe casts
- Async-first where reasonable
- Never emit `.js` or `.mjs`
- Dev servers must not start unless explicitly requested
- Prefer functional patterns over classes
- Trust inference internally, be explicit at boundaries

## Repository Structure

### Root Layout

```bash
apps/
components/
documentation/
packages/
scripts/
```

### apps/

Deployable runtimes.

Each app is an independent entrypoint.

```bash
apps/
api
cli
desktop
mobile
web
```

### Rules

- Apps may depend on `packages/` and `components/`
- Apps must never be imported by `packages/`
- Apps define runtime, environment wiring, and deployment config
- Business logic must not live directly inside apps

`apps/api` is a thin wrapper around `@repo/server`.

### packages/

Reusable platform modules.

```bash
packages/
auth
billing
convex
db
email
env
kv
sdk
server
storage
tailwind
tsconfig
```

### Responsibilities

- `server/` → backend runtime core (Elysia, ORPC server, middleware)
- `sdk/` → public client API (transport + contracts only)
- `db/` → persistence layer (schema, connection, repos)
- `auth/` → authentication logic
- `billing/` → subscriptions, plans, financial orchestration
- `convex/` → Convex cloud backend logic
- `kv/` → cache or ephemeral storage
- `storage/` → file/object storage abstraction
- `env/` → typed environment access
- `tailwind/` → design preset
- `tsconfig/` → shared TS config

### Architectural Constraints

- Packages may depend on other packages
- Packages must never depend on apps
- `sdk` must not depend on `server`
- `db` must not depend on `server`
- `server` may depend on other packages
- Avoid circular dependencies

### components/

UI component libraries.

```bash
components/
web/
blocks/
ui/
mobile/
blocks/
ui/
```

### Rules

- Components must not contain business logic
- UI must remain presentation-focused
- Shared visual primitives belong in `ui/`
- Feature-level components belong in `blocks/`
- Components may depend on `packages/sdk`
- Components must not depend on `packages/server`

### scripts/

Automation only.

- Local tooling
- CI helpers
- Release scripts
- Non-runtime utilities

Scripts are not imported by runtime packages.

### Dependency Rules

Allowed:

- `apps/* -> packages/*`
- `apps/* -> components/*`
- `server -> db`
- `server -> auth`
- `sdk -> env`
- `components -> sdk`

Forbidden:

- `packages/* -> apps/*`
- `sdk -> server`
- `db -> server`
- Circular imports

### TypeScript Rules

- Strict mode mandatory
- No `any`
- No unsafe casts
- Use `unknown` only at real external boundaries
- Explicit types at API boundaries
- Inference inside modules
- Functional style preferred

### Backend Rules

- Backend logic lives in `packages/server`
- `apps/api` is runtime entry only
- Persistence logic lives in `packages/db`
- Convex logic isolated inside `packages/convex`
- No database access outside `server` or `convex`

### Import Rules

- Always use workspace aliases (`@repo/*`)
- No deep relative imports across packages
- No cross-layer violations

### Code Discipline

- Prefer early returns
- Avoid unnecessary `else`
- Avoid defensive overengineering
- No redundant abstractions
- No speculative helpers
- If logic needs explanation, simplify it
- Do not modify unrelated code
- Preserve implicit assumptions
- Optimize for long-term clarity

### Comments

- No tutorial comments
- No restating obvious behavior
- Only explain non-obvious intent
- Comments must serve developers or users

### Design Philosophy

- Composition over abstraction
- Small, focused modules
- Minimal hidden side effects
- Stable architecture before feature velocity
- Refactor instead of patch
- Clarity is the highest priority
