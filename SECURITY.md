# Security Policy

Security matters deeply to the Reliverse community. If you believe you've discovered a security vulnerability, thank you.

Please **do not** open a public GitHub issue, as we'd like to handle it responsibly and protect users while we investigate.

## Reporting a Vulnerability

Please report security issues privately using one of the following channels:

- **Email**: [blefnk@gmail.com](mailto:blefnk@gmail.com).
- **GitHub private vulnerability reporting**, when enabled for this repository: [open a private report](https://github.com/reliverse/reliverse/security/advisories/new) via the Security tab. If that option is unavailable, use email; do not substitute a public issue.

When reporting, the more context you can share, the better. Helpful details may include:

- A clear description of the issue and its potential impact
- Steps to reproduce (a proof-of-concept is welcome)
- The affected public commit, component/package version and operating system
- Minimal relevant logs or screenshots, with credentials, personal data and private operational state removed
- A suggested fix or mitigation (if you have one)
- Whether the issue concerns ordinary local inspection, a remote Git operation or an explicitly configured protected workflow

Use test data and the smallest reproduction you can. Do not send private keys, access tokens, session cookies, entire workspace archives or managed private-state directories. Do not access another person's data or disrupt a service to collect additional evidence. These reporting instructions do not grant testing authorization or legal safe harbor.

## Vulnerability Severity

Reliverse uses the Common Vulnerability Scoring System (CVSS) as a reference when assessing reported issues.

Higher-severity reports receive priority, but CVSS alone does not determine the response. Reachability, affected public versions, required privileges, practical impact and available mitigations also matter.


## Response & Disclosure

- Maintainers aim to acknowledge reports and investigate as capacity permits; no fixed response or remediation time is promised.
- Share only necessary details. Maintainers may need to involve affected contributors or upstream maintainers; absolute confidentiality cannot be guaranteed.
- Please coordinate a reasonable disclosure timeline privately, taking any fix or mitigation into account.
- Say whether you would like public credit or prefer to remain anonymous. Credit is not a promise of a bounty or compensation.

Our goal is responsible disclosure, coordinated fixes, and transparency with users.

## Supported Versions

Reliverse is being opened incrementally. There is no blanket support or backport guarantee for every package version, historical snapshot or private deployment. The published default branch and any explicitly supported package releases are the starting points for investigation; identify your exact public commit/version in a report.

A read-only source preview is not certification of the full CLI, protected host or unrelated packages. The code does not become supported merely because a file or root manifest is public. See [OPEN-SOURCING.md](./OPEN-SOURCING.md) for the publication model.

For ordinary help use [SUPPORT.md](./SUPPORT.md); for community conduct concerns use the private channel in [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

Protecting user trust is a shared responsibility, and your help makes a real difference.

Thank you for helping keep Reliverse secure.
