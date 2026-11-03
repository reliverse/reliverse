# Reliverse support

Reliverse is maintained as an evolving open-source project. This page explains where to get help and how to file actionable reports.

## Questions and usage help

Start with the [README](./README.md), the available package or CLI README, and [OPEN-SOURCING.md](./OPEN-SOURCING.md). Some systems are still being published in stages, so the public repository may not include every dependency or runtime service.

The source inspection preview is intentionally separate from the full CLI. It should not require a GR login, SSH key, sudo or dependency installation. For that preview, include the output of its focused smoke test when useful; do not bootstrap a protected host just to reproduce a read-only problem.

If you're blocked, search [existing issues](https://github.com/reliverse/reliverse/issues) and open a focused new issue if needed. Include the affected command/package, **public commit**, operating system, relevant version, expected behavior, and a minimal reproduction. Indicate whether the failure is a missing public dependency, a requirement for an installed/privileged host, or a reproducible command defect. Redact secrets, personal data, and private receipts; don't upload your entire private runtime state as a reproduction.

## Bugs and feature requests

- [Report a bug](https://github.com/reliverse/reliverse/issues/new/choose).
- For substantial features, please describe the concrete use case before preparing a large PR.
- A small reproduction is more useful than a full workspace archive. Share only the relevant redacted output, and say which checkout/command you used.
- [Contribution guidelines](./CONTRIBUTING.md) explain the development and review expectations.

## Security vulnerabilities

**Do not report vulnerabilities in public issues.** Use the private channel described in [SECURITY.md](./SECURITY.md).

## Response expectations

This is an independently maintained project, so response times and roadmap priorities are not guaranteed. GitHub Sponsors can [support ongoing development](https://github.com/sponsors/blefnk), but sponsorship does not purchase priority support or specific features.
