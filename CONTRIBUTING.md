# Contributing to Reliverse

Thanks for your interest in Reliverse. Small, understandable improvements and concrete bug reports are very welcome.

Reliverse is being open-sourced in stages. **Check the currently published source** before assuming that every module, service, and dependency is available to external contributors.

## Before starting

- Search [existing issues](https://github.com/reliverse/reliverse/issues) for duplicates.
- Good first contributions include minimal public reproductions, focused tests, and corrections to commands or examples that can be checked without privileged infrastructure.
- For small, well-scoped fixes, open a focused pull request explaining the behavior and its verification.
- For large features, new APIs, protected workflows, or architectural changes, discuss the proposal in an issue first. An unsolicited large PR may be difficult for a small maintainer team to review.
- Never paste secrets, private operational receipts, credentials, personal host information, or sensitive logs into issues and pull requests.

## Development setup

Use the Bun version specified in the **checked-out** root `package.json` (`packageManager`) and have Git on your PATH. Local development snapshots and public `main` may contain different source subsets.

```sh
git clone https://github.com/reliverse/reliverse.git
cd reliverse
```

### Start with the source inspection preview

If your checkout contains `examples/gr/inspect.ts`, these commands require no dependency installation, GR login, SSH key, sudo or protected host:

```sh
bun --no-install --no-env-file examples/gr/inspect.ts .
bun --no-install --no-env-file test examples/gr/inspect.test.ts
```

See the [README](./README.md#first-look-read-only-gr-inspection) for expected output and limitations. This exercises GR's source inspection module, not an installed full CLI. If the example is absent from your checkout, it has not arrived in that public source state; do not reconstruct it from private dependencies.

### Work on a broader package

Read the package's available setup instructions and check that its dependencies are in the public checkout. When that workflow actually needs dependencies, a conservative starting point is:

```sh
bun install --frozen-lockfile --ignore-scripts
```

This is **not** certification of a whole-monorepo clean install. `--ignore-scripts` skips dependency lifecycle scripts; some packages may need separately documented generated artifacts or builds. Do not regenerate the lockfile or enable scripts merely to hide a missing public dependency. Report the public commit and first actionable error instead. See [the publication model](./OPEN-SOURCING.md).

### Repository structure

This is the larger workspace map, not a guarantee that every directory or command is present in a particular public checkout:

- `apps/cli/`: command-line applications such as `rse`, `gr`, and `rq`.
- `apps/web/`: web applications and project surfaces.
- `packages/`: reusable libraries and domain packages.
- `extensions/`: plugins and extensions.
- `scripts/`: source-controlled tooling scripts.
- `tests/`: cross-cutting test fixtures and checks.

## Verification

Start with the smallest check that covers your change. For the source inspection preview:

```sh
bun --no-install --no-env-file test examples/gr/inspect.test.ts
```

For other packages, use checks that are actually present in your checkout and install only their supported dependencies.

Use package-owned typecheck/lint commands when available. Explain what you ran and what you could **not** run. Do not treat a whole-monorepo test/build as mandatory for a focused documentation fix; broad checks are appropriate only when the change's actual risk warrants them.

For behavior changes, add a relevant regression test. For documentation changes, check paths, links, commands, and the distinction between implemented behavior and planned features. Global `bun run test` and `bun run typecheck` are broader orchestration entry points; do not use them as an automatic requirement for a narrow change without confirming their current public dependencies and scope.

## Pull requests

Please keep one coherent objective per PR. Describe:

1. What changed and why.
2. Which source paths, public contracts, and behavior are affected.
3. Focused tests or manual checks, including known limitations.
4. Whether AI assistance was used to author substantive code or prose, and what you personally reviewed.

AI-assisted contributions are welcome when the contributor understands and verifies them. Do not bulk-submit unreviewed agent-generated issues or PRs. Maintainers may ask for a smaller, reproducible scope before reviewing a large contribution.

If your contribution affects sensitive Git mutation, approvals, authentication, publication, or recovery, follow the existing owning contracts. A contributor may use ordinary Git in their fork; maintainers' protected publication through GR is a separate authorization boundary, not a rule to forbid everyday local Git use.

## Documentation and disclosure

Keep public documentation focused on reproducible contributor-facing behavior. Do not copy private deployment history or operator-specific information into public Markdown.

Changes involving `docs/**` require a separate maintainer-approved publication/disclosure review during the current staged release. **This is a project publication constraint, not a built-in global GR rejection rule.** Do not include that directory in a proposed public campaign without an explicit reviewed policy change.

## Getting help and reporting security issues

Use [SUPPORT.md](./SUPPORT.md) for questions and [SECURITY.md](./SECURITY.md) for private vulnerability reporting. Please don't disclose security issues in public issues, PRs, or discussions.

By participating, you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).
