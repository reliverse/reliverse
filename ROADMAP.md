# Reliverse Monorepo Roadmap

This roadmap describes direction, not guarantees.

## North Star

Reliverse is a calm, tool-first monorepo for:
- developer workflows
- the `rse` CLI and plugins
- reusable UI packages
- web and docs surfaces for those tools

## Definition of Done

- Types validated
- Docs updated when behavior changed
- No stale workspace references
- Clear CLI/help output for user-facing commands
- Dry-run-first behavior where it materially reduces risk

## Current Focus Areas

### Apps

#### apps/web
- [ ] tighten landing-page content for each major tool/plugin
- [ ] remove remaining product-era placeholders
- [ ] keep performance and accessibility sane

#### apps/wiki
- [ ] finish docs rewrite around the new tool-first scope
- [ ] document `rse build` / `rse pub`
- [ ] add migration notes for old package-level build scripts

#### apps/cli
- [ ] keep `rse` discoverable and pleasant to use
- [ ] improve top-level help for direct commands like `build` and `pub`
- [ ] keep plugin loading predictable in local development

### Packages

#### packages/rempts
- [ ] keep file-based command loading simple
- [ ] improve plugin-host ergonomics
- [ ] document host/plugin boundaries clearly

#### packages/ui
- [ ] keep primitives clean and dependency-light
- [ ] audit accessibility defaults

#### packages/blocks
- [ ] align blocks with the new site/docs direction
- [ ] remove old app/backend assumptions

#### packages/relico / myenv / ui-utils
- [ ] keep helpers small and boring in the best way

#### packages/tailwind / tsconfig
- [ ] keep shared presets minimal and stable

### Plugins

#### plugins/dler
- [ ] finish the generated-command architecture cleanup
- [ ] keep workspace-level build/pub flows authoritative
- [ ] improve reporting around ignored packages and skipped targets

#### plugins/pm
- [ ] improve examples after the repo trim
- [ ] keep add/update flows dry-run-first

#### plugins/tools / os / agent
- [ ] keep commands scoped and sharp

## Repo Hygiene

- [ ] finish removing docs references to deleted product-era packages/apps
- [ ] audit root scripts for obsolete aliases
- [ ] keep workspace metadata aligned with the actual repo
- [ ] add CI that matches the trimmed monorepo reality

## Explicit Non-Goals for This Repo

These moved out of Reliverse and should not quietly grow back here:
- auth system
- backend API runtime
- billing stack
- mobile app
- desktop app
- social/end-user frontend features

Those belong to Bleverse or other dedicated repos.
