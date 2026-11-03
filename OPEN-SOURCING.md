# Opening Reliverse in stages

Reliverse's modern Bun and TypeScript monorepo is being released incrementally. Publication happens through **bounded, reviewable GR campaigns**, rather than an unreviewed dump of a larger private working tree.

## What a public campaign proves

A campaign can publish a specifically reviewed set of source paths and commits. An accepted public Git commit proves those **bytes are in the repository history**; it does not, on its own, prove a distributable package, a usable hosted service, an installed privileged operator, or a verified clean-checkout build.

The actual public repository and its commit history are the evidence of what has shipped: <https://github.com/reliverse/reliverse>.

## What may still be unavailable

- Parts of the dependency graph may arrive in later campaigns; a root manifest alone does not prove a fresh public installation succeeds.
- Protected Git publication, identity, signing, and deployment paths may require owner-only infrastructure that is not part of public source.
- Repository-local examples and standalone installation support must be validated separately.
- Source availability, package versions, npm publication, and the broader **Reliverse 0.1.0 era** are distinct concepts.

## Documentation boundary

Contributor-facing root documents and a small source example can be published independently of the larger documentation tree. During staged publication, inclusion of `docs/**` requires its own explicit scope, policy and disclosure review. GR does not hard-code a global `docs/**` ban, and a past publication scope is not automatic authorization for a later one.

Public-facing files such as this page, the root README, contribution guidance, and security reporting should never expose private operator state, host credentials, incident history, or live publication receipts.

## Evaluating a public checkout

Start with the [README's read-only entry point](./README.md#first-look-read-only-gr-inspection) and use the Bun pin from the checked-out root manifest. The source inspection preview uses a small GR source-module subset and needs no dependency installation. It does not claim that the complete `@reliverse/gr` package, full CLI or monorepo install is ready.

Record the public commit, exact command and result when reporting a problem. Missing source, a dependency-install failure, a command defect and a protected-host requirement are different issues. Protected publication and other privileged operations are separate opt-in workflows, not prerequisites for the source preview.

## Following progress

- Start with the [README](./README.md) and its source availability notes.
- Review [public commits](https://github.com/reliverse/reliverse/commits/main) for actual publication events.
- Use [Issues](https://github.com/reliverse/reliverse/issues) to report a reproducible problem or suggest an improvement.

We will avoid presenting planned features as shipped or publishing private operational artifacts as proof of progress.
