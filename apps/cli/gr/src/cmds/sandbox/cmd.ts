import { defineCommand } from "@reliverse/rempts";

export default defineCommand({
  meta: {
    name: "sandbox",
    description: "Materialize, capture, and clean up exact ephemeral snapshot sandboxes.",
  },
  help: {
    examples: [
      "gr sandbox materialize <baseline-snapshot.json> --apply",
      "gr sandbox capture <baseline-snapshot.json> <materialization.json> src/index.ts --apply",
      "gr sandbox cleanup <materialization.json> --apply",
    ],
  },
});
