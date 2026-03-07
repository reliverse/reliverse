# Reliverse Monorepo Roadmap

This roadmap describes **direction**, not guarantees. Priorities may shift based on feedback, maintainer time, and architecture constraints.

## North Star

- Calm, focused UX (no dark patterns)
- Modular monorepo architecture
- Explicit system behavior
- Accessibility by default
- Consent-first configuration
- Clear architectural boundaries

## Definition of Done

- Types validated
- No boundary violations
- Accessibility sanity pass
- Documentation updated
- Breaking changes documented
- Dependency graph unchanged (unless intentional)

## Global TODOs (Cross-Cutting)

### Product / UX

- [ ] Short onboarding with explicit personalization toggles
- [ ] Unified privacy language + consistent visibility rules
- [ ] Calm microcopy (no urgency mechanics)
- [ ] Clear settings visibility (explainable system state)

### Platform / Security / Reliability

- [ ] Lightweight threat model + release checklist
- [ ] Baseline rate limiting
- [ ] Audit trail (auth, permissions, billing)
- [ ] Backup + restore verification
- [ ] Structured logging + health endpoints
- [ ] Core metrics (latency, errors, usage)

### DX / Repo Hygiene

- [ ] One-command Quickstart
- [ ] CI: typecheck / lint / test / build
- [ ] Versioning policy (public API boundaries)
- [ ] Conventional commits or equivalent
- [ ] Issue/PR templates + label taxonomy
- [ ] Clear dependency graph documentation

## apps/

Deployable runtimes.

### apps/api (api.reliverse.org)

Thin runtime wrapper over `@repo/server`.

- [ ] Auth middleware wiring
- [ ] Public API versioning (`/v1`)
- [ ] Rate limiting (IP + account)
- [ ] Health + readiness checks
- [ ] Job orchestration (email, billing, cleanup)
- [ ] Error normalization (public vs internal)
- [ ] Observability wiring

### apps/web (reliverse.org)

- [ ] App shell (routing + layout)
- [ ] Auth UX
- [ ] User preferences + visibility controls
- [ ] Accessibility pass
- [ ] Core Web Vitals optimization
- [ ] Consent-first personalization

### apps/mobile

- [ ] Auth flow
- [ ] Secure session storage
- [ ] Screen parity with web
- [ ] Offline tolerance
- [ ] Opt-in notifications
- [ ] Accessibility review

### apps/desktop

- [ ] Shell + update strategy
- [ ] Secure token storage
- [ ] Deep links
- [ ] Shared UI with web
- [ ] Transparent crash reporting

### apps/cli

- [ ] `reliverse dev`
- [ ] `reliverse doctor`
- [ ] Scaffold generators
- [ ] Admin helpers (seed, migrate, create-user)
- [ ] Release helpers

## components/

Presentation layer only.

### components/web

/blocks

- [ ] Feature-level composition blocks
- [ ] A11y primitives (focus, ARIA, keyboard patterns)
- [ ] Shared composition conventions

/ui

- [ ] Button, form, dialog, toast primitives
- [ ] Empty states
- [ ] Accessible defaults

## components/mobile

/blocks

- [ ] Feature-level mobile compositions
- [ ] Navigation patterns

/ui

- [ ] Shared mobile primitives
- [ ] Accessible defaults

## packages/

Reusable platform modules.

### packages/server

Backend runtime core.

- [ ] Route composition system
- [ ] Unified error model
- [ ] Middleware architecture
- [ ] Dependency injection pattern (if needed)
- [ ] Observability hooks
- [ ] Public API boundary enforcement

### packages/sdk

Public client contract layer.

- [ ] Typed API client
- [ ] DTO definitions
- [ ] Error normalization
- [ ] Auth-aware client (token refresh)
- [ ] Stable versioning guarantees
- [ ] Clear separation from server runtime

### packages/db

Persistence layer.

- [ ] Canonical schema
- [ ] Migration strategy
- [ ] Indexing strategy
- [ ] Seed fixtures
- [ ] Backup/restore docs

### packages/auth

- [ ] Session lifecycle
- [ ] Role/scopes model
- [ ] Multi-device sessions
- [ ] Audit events
- [ ] Hardened recovery flow

### packages/billing

- [ ] Plans + entitlements
- [ ] Subscription lifecycle
- [ ] Webhook ingestion
- [ ] Idempotency guarantees
- [ ] Transparent billing UX principles

### packages/storage

- [ ] Storage abstraction
- [ ] Signed URLs
- [ ] Access policies
- [ ] File constraints

### packages/kv

- [ ] Namespaced keys
- [ ] TTL rules
- [ ] Dev fallback
- [ ] Rate limiting primitives

### packages/email

- [ ] Transactional templates
- [ ] Optional i18n
- [ ] Bounce handling
- [ ] Rate limiting

### packages/env

- [ ] Typed schema
- [ ] Server/client split
- [ ] Fail-fast validation
- [ ] `.env.example`

### packages/convex

Cloud-specific backend logic.

- [ ] Clear scope definition
- [ ] Sync contracts
- [ ] Retry strategy
- [ ] Observability
- [ ] Data ownership clarity

### packages/tailwind

Design preset.

- [ ] Design tokens
- [ ] Light/dark themes
- [ ] Accessible contrast
- [ ] Shared preset across apps

### packages/tsconfig

- [ ] Unified strict policy
- [ ] Shared base configs
- [ ] Path aliases

## documentation/

- [ ] Architecture overview (apps vs packages)
- [ ] Dependency graph
- [ ] Setup guide
- [ ] Contribution guide
- [ ] Consent/privacy model
- [ ] ADRs for major changes

## scripts/

- [ ] CI helpers
- [ ] Release scripts
- [ ] Migration scripts
- [ ] Backup scripts

## Complete Initial Issues (before 0.1.0 release)

- [x] push initial commit
- [x] init @repo/reliverse-root
- [x] init @repo/reliverse-web
- [x] init @repo/reliverse-api
- [x] init @repo/reliverse-cli
- [x] init @repo/reliverse-docs
- [x] init @repo/reliverse-mobile
- [x] init @repo/reliverse-desktop
- [x] init @repo/ui @repo/blocks (web)
- [x] init @repo/ui @repo/blocks (mobile)
- [x] init: tailwind, tsconfig, @reliverse/sdk
- [x] init packages: server, env, kv, db, convex
- [x] init packages: auth, storage, billing, email
- [x] add .vscode: settings.json and extensions.json
- [x] add .agents/skills: standards and remove-slop
- [x] add: turbo.json, biome.json, scripts/clean.sh
- [x] add .agents/skills: reliverse and frontend
- [x] add files: README.md, LICENSE, NOTICE
- [x] add: CONTRIBUTING.md, CHANGELOG.md
- [x] add: CODE_OF_CONDUCT.md, SECURITY.md
- [x] add: .github/FUNDING.yml, ROADMAP.md
- [x] migrate from biome to oxc lint and fmt
- [x] implement .github/workflows/deploy.yml
- [x] implement initial web routes and env vars

## Polish Markdown Files (before 0.2.0 release)

- [ ] .agents/README.md
- [ ] .agents/skills/code-standards/SKILL.md
- [ ] .agents/skills/electrobun-apps/SKILL.md
- [ ] .agents/skills/frontend-design/SKILL.md
- [ ] .agents/skills/reliverse-tools/SKILL.md
- [ ] .agents/skills/remove-slop/SKILL.md
- [ ] apps/desktop/README.md
- [ ] apps/web/README.md
- [ ] apps/web/content/blog/architects.md
- [ ] apps/web/content/blog/index.mdx
- [ ] apps/web/content/blog/soul.md
- [ ] CHANGELOG.md
- [ ] CODE_OF_CONDUCT.md
- [ ] CONTRIBUTING.md
- [ ] documentation/README.md
- [ ] documentation/content/docs/core/env.md
- [ ] documentation/content/docs/core/features.mdx
- [ ] documentation/content/docs/core/getting-started.mdx
- [ ] documentation/content/docs/core/index.mdx
- [ ] documentation/content/docs/core/resources.md
- [ ] documentation/content/docs/core/standards.md
- [ ] documentation/content/docs/index.mdx
- [ ] documentation/content/docs/philosophy/accessibility.mdx
- [ ] documentation/content/docs/philosophy/advertising.md
- [ ] documentation/content/docs/philosophy/no-dark-patterns.md
- [ ] documentation/content/docs/philosophy/privacy.mdx
- [ ] documentation/content/docs/philosophy/reliverse.md
- [ ] packages/convex/AGENTS.md
- [ ] packages/convex/ARCHITECTURE.md
- [ ] README.md
- [ ] ROADMAP.md
- [ ] SECURITY.md
- [ ] TRADEMARK.md

## Polish JSON Files (before 0.3.0 release)

- [ ] .oxfmtrc.json
- [ ] .oxlintrc.json
- [ ] .vscode/extensions.json
- [ ] .vscode/settings.json
- [ ] apps/api/package.json
- [ ] apps/api/tsconfig.json
- [ ] apps/cli/package.json
- [ ] apps/desktop/package.json
- [ ] apps/desktop/tsconfig.json
- [ ] apps/mobile/eas.json
- [ ] apps/mobile/package.json
- [ ] apps/mobile/tsconfig.json
- [ ] apps/web/components.json
- [ ] apps/web/package.json
- [ ] apps/web/tsconfig.json
- [ ] components/mobile/blocks/package.json
- [ ] components/mobile/ui/package.json
- [ ] components/web/blocks/components.json
- [ ] components/web/blocks/package.json
- [ ] components/web/blocks/tsconfig.json
- [ ] components/web/ui/components.json
- [ ] components/web/ui/package.json
- [ ] components/web/ui/tsconfig.json
- [ ] documentation/package.json
- [ ] documentation/tsconfig.json
- [ ] package.json
- [ ] packages/auth/package.json
- [ ] packages/auth/tsconfig.json
- [ ] packages/billing/package.json
- [ ] packages/billing/tsconfig.json
- [ ] packages/convex/convex.json
- [ ] packages/convex/package.json
- [ ] packages/convex/tsconfig.json
- [ ] packages/db/package.json
- [ ] packages/db/tsconfig.json
- [ ] packages/email/package.json
- [ ] packages/email/tsconfig.json
- [ ] packages/env/package.json
- [ ] packages/env/tsconfig.json
- [ ] packages/kv/package.json
- [ ] packages/kv/tsconfig.json
- [ ] packages/sdk/package.json
- [ ] packages/server/package.json
- [ ] packages/server/tsconfig.json
- [ ] packages/storage/package.json
- [ ] packages/storage/tsconfig.json
- [ ] packages/tailwind/package.json
- [ ] packages/tsconfig/package.json
- [ ] packages/tsconfig/ts-files-only.json
- [ ] packages/tsconfig/tsx-support.json
- [ ] scripts/package.json
- [ ] scripts/tsconfig.json
- [ ] turbo.json
