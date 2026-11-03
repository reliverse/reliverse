# Reliverse

**Open-source Bun and TypeScript tooling for inspectable, reproducible developer workflows.**

> Clear by design. Modular by architecture.

Reliverse helps maintainers inspect repository state, check changes, and build reviewable automation instead of relying on opaque, uncontrolled steps. It combines CLI tools, reusable packages, and developer infrastructure; parts also underpin [Bleverse](https://github.com/reliverse).

The modern monorepo is being **opened progressively**. A published source file is not automatically an installable tool, a running service, or a supported release.

## What is here?

| Area | Purpose | Public status |
| --- | --- | --- |
| **[GR](#first-look-read-only-gr-inspection)** (Git-backed repository workflows) | Inspect repository state and prepare bounded, reviewable changes. | **Preview:** source inspection below; the full CLI and protected host are separate. |
| **RQ** (Reliverse Quality) | Check and explain repository and code-quality findings. | **Planned:** standalone public first-run; not part of the inspection smoke check below. |
| **Rse** | Compose developer tools and optional agent workflows. | **Preview:** active development; some features require unpublished or separately installed components. |

These are **capabilities**, not a promise that every package or hosted service is production-ready. Read [OPEN-SOURCING.md](./OPEN-SOURCING.md) for the publication model and limitations.

## First look: read-only GR inspection

Prerequisites: **Git** and the Bun version in the **checked-out** root `packageManager` field. This preview runs GR's existing source inspection module directly; it is not an installation of the full `gr` CLI or `@reliverse/gr` package. It needs no dependency installation, GR login, SSH key, sudo or protected Native setup.

In a checkout containing [`examples/gr/inspect.ts`](./examples/gr/inspect.ts):

```sh
bun --no-install --no-env-file examples/gr/inspect.ts .
```

For a clean checkout on a local branch with an existing commit, the output is:

```text
GR source inspection (read-only)
HEAD: attached
Workspace: clean
Changes: 0 staged, 0 unstaged, 0 untracked, 0 conflicted
```

A dirty checkout reports its actual counts without staging, resetting, committing, pushing or changing file contents. An empty Git repository reports `HEAD: unborn`. You can pass another repository root instead of `.`. Paths are inspected locally; no remote Git operation is requested.

Run the focused smoke check with no dependency installation:

```sh
bun --no-install --no-env-file test examples/gr/inspect.test.ts
```

[The smoke workflow](./.github/workflows/gr-inspect-smoke.yml) checks this source example and preservation of staged/unstaged/untracked data; it does **not** certify a full-monorepo install, the full CLI, signing or publication. Public `main` may not yet contain this preview while staged publication is in progress. If the example is absent, do not reconstruct it from private dependencies or assume that `bun run gr status` is available. See [CONTRIBUTING.md](./CONTRIBUTING.md) for broader development guidance.

## Repository map

| Path | Role |
| --- | --- |
| `apps/cli/` | CLI entry points, including `gr`, `rq`, `rse`, and supporting tools. |
| `apps/web/` | Web applications and public-facing surfaces. |
| `packages/` | Reusable libraries, domain packages, and infrastructure components. |
| `extensions/` | Plugin and extension implementations. |
| `tests/` | Cross-package and repository tests. |
| `.agents/` | Repository-authored agent guidance; local agent state is not public source. |

Some directories contain work in progress or unpublished dependencies. The presence of source code is not a release, package publication, or support guarantee.

## Contributing and support

- [Contribution guide](./CONTRIBUTING.md): ways to contribute, setup, and focused testing.
- [Support](./SUPPORT.md): where to ask questions and report problems.
- [Code of conduct](./CODE_OF_CONDUCT.md): community expectations.
- [Security policy](./SECURITY.md): **privately** report vulnerabilities; do not open public security issues.
- [Open-sourcing status](./OPEN-SOURCING.md): scope and trust boundaries.

Issues: <https://github.com/reliverse/reliverse/issues>

## Support ongoing development

Reliverse is independently maintained. If its work is useful to you, consider [GitHub Sponsors](https://github.com/sponsors/blefnk). Sponsorship is optional and does not affect access to MIT-licensed source code.

## License and branding

The repository root uses the [MIT License](./LICENSE); some components may carry their own license terms. Project names and logos are covered separately by the [trademark policy](./TRADEMARK.md).
