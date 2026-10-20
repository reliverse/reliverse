# @reliverse/quality

Typed check, deterministic planning, controlled apply, and verification domain
kernel for Reliverse Quality (RQ).

The package owns reusable contracts for:

- quality suites, capabilities, rules, and providers;
- effect declarations and read-only check authorization;
- stable diagnostics, evidence, explanations, and fingerprints;
- deterministic provider selection and check results;
- declarative change operations, preconditions, risks, verification steps, and
  stable semantic plan fingerprints;
- plan-only effect authorization that rejects target mutation effects;
- explicit apply authorization and operation-specific effect grants;
- full stale-state and repository-root path-safety preflight;
- RQ-core execution of the six standard declarative operation kinds;
- fingerprinted `rq.apply-receipt.v0` and `rq.verification-receipt.v0` receipts;
- separate typed verification through declared quality checks;
- an in-memory quality registry for installed suites.

It does not own plugin discovery, package identity, CLI artifact placement, Git
snapshots, patches, rollback, or recovery. A Rempts-based host uses
`@reliverse/quality/rempts` to receive a suite from one normal Rempts plugin.
Standard apply operations are executed by this package rather than by unrestricted
plugin callbacks.

```ts
import { defineQualitySuite } from "@reliverse/quality";
import { defineQualityContribution } from "@reliverse/quality/rempts";
import { definePlugin, REMPTS_PLUGIN_API_VERSION } from "@reliverse/rempts";

const suite = defineQualitySuite({
  id: "repo",
  title: "Repository Quality",
  description: "Repository policy checks.",
  capabilities: [],
  rules: [],
  providers: [],
});

export default definePlugin({
  apiVersion: REMPTS_PLUGIN_API_VERSION,
  entry: import.meta.url,
  name: "repo-rq-plugin",
  contributions: [defineQualityContribution(suite)],
});
```
