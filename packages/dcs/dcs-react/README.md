# `@reliverse/dcs-react`

The package is published as the framework-specific source-generation companion used by `@reliverse/dcs/node`; it does not change DCS resolution semantics.

Optional React source generator for DCS contracts.

The package does **not** bundle React and does not render a UI at runtime. It
emits owned TSX source for a target product, so DCS core stays browser-safe and
framework-neutral.

Use it through the reference CLI:

```bash
dcs ui doctor --preset tailwind-shadcn-v4 --workspace .
dcs ui generate --bundle ./rse.config-contract.json \
  --preset tailwind-shadcn-v4 \
  --out-dir ./src/generated/dcs/rse \
  --workspace .
```

See `docs/specs/dcs/15-ui-codegen.md` for security and ownership rules.
