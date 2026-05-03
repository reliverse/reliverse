import { defineCommand } from "@reliverse/rempts";

import { runDoctor } from "../../../impl/core/doctor";
import {
  formatDoctorSummary,
  getCommandContext,
  handleRelpackError,
  isJsonOutput,
  printDiagnostics,
  printJson,
} from "../_shared";

const COMMAND_NAME = "doctor";

export default defineCommand({
  meta: {
    name: COMMAND_NAME,
    description: "Inspect installed archive backends and supported formats.",
  },
  conventions: {
    idempotent: true,
    supportsApply: false,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: false,
    effects: ["fs.read"],
  },
  help: {
    examples: ["rse relpack doctor", "rse relpack doctor --json"],
    text: "Check whether tar, zip/unzip, and 7z-compatible tools are available for relpack.",
  },
  options: {},
  async handler(ctx) {
    try {
      const commandContext = getCommandContext();
      const doctor = await runDoctor(commandContext);

      if (isJsonOutput(ctx)) {
        printJson(ctx, {
          ok: true,
          command: COMMAND_NAME,
          diagnostics: doctor.diagnostics,
          backends: doctor.backends,
        });
      } else {
        printDiagnostics(ctx, doctor.diagnostics);
        ctx.out?.(formatDoctorSummary(doctor.backends));
      }
    } catch (error) {
      handleRelpackError(ctx, COMMAND_NAME, error);
    }
  },
});
