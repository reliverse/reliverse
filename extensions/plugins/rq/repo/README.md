# @reliverse/repo-rq-plugin

Headless Rempts plugin that contributes repository policy capabilities to Reliverse Quality.

```txt
repo.naming
repo.packages
repo.dependencies
repo.boundaries
repo.topology
repo.tsconfig
repo.fixtures
repo.cli
repo.rempts
repo.dcs
repo.tool-bridges
repo.runtime
repo.docs
repo.schemas
repo.specs
repo.lockfile
repo.type-supply
repo.paths
repo.concepts
```

The plugin owns no separate `rq repo ...` command tree. Central RQ surfaces consume its typed `rq.quality-suite@0` contribution. Reusable policy inspectors are exported from `@reliverse/repo-rq-plugin/policy`.

Repository policy is mounted through DCS at `plugins.repo`:

- `plugins.repo.schemas` governs pre-1 serialized contract generations;
- `plugins.repo.specs` governs living Spec adoption;
- `plugins.repo.naming` governs package identity;
- `plugins.repo.packages` selects governed package families;
- `plugins.repo.tsconfig` governs TypeScript project contracts.

`repo.schemas` distinguishes Reliverse-owned contracts from third-party URLs and standards. In enforced mode it rejects active `schemaVersion`, API/protocol fields, named contract-version constants, and owned `.v1+` or `/v1+` identifiers while the root repository remains below `1.0.0`. Explicit mismatch fixtures may be excluded narrowly; production roots are not blanket-exempted.

`repo.naming` provides deterministic `check`, `explain`, `plan`, `apply`, and `verify` operations. Standard mutation is executed by RQ core from a reviewed plan, not by arbitrary plugin callbacks. Other capabilities are currently read-only checks.
