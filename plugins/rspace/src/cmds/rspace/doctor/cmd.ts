import { defineCommand } from "@reliverse/rempts";

import { runRspaceDoctorCommand } from "../../../impl/doctor";

export default defineCommand({
  meta: {
    name: "doctor",
    description: "Check whether the local environment can work with Rspace artifacts",
  },
  agent: {
    notes: "Use this read-only check when diagnosing Rspace archive/workspace issues.",
  },
  conventions: {
    idempotent: true,
    supportsApply: false,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: false,
    effects: ["fs.read", "process.exec"],
  },
  help: {
    examples: ["rse rspace doctor"],
    text: "Check local Rspace tooling and environment assumptions",
  },
  options: {},
  async handler(ctx: unknown) {
    return await runRspaceDoctorCommand(ctx);
  },
});
