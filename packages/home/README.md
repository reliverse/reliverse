# @reliverse/home

Product-neutral v0 contracts and local primitives for the publisher home at
`~/.reliverse`.

The package owns stable opaque Principal IDs, Home contributions, path classes,
preview-first initialization, inspection, shared Git allowlisting, and the
pre-commit guard. It does not own Rse Agent semantics, DCS document semantics,
Rempts rendering, cloud identity linking, or database-backed Spaces.

```ts
import { applyReliverseHomeInitPlan, planReliverseHomeInit } from "@reliverse/home";

const plan = await planReliverseHomeInit({
  principalHandle: "operator",
});

await applyReliverseHomeInitPlan(plan);
```
