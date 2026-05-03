import { getAdapters } from "./adapters/registry";
import type { CommandContext, Diagnostic } from "./types";

export interface DoctorReport {
  readonly diagnostics: readonly Diagnostic[];
  readonly backends: readonly {
    readonly id: string;
    readonly available: boolean;
    readonly formats: readonly string[];
  }[];
}

export async function runDoctor(ctx: CommandContext): Promise<DoctorReport> {
  const backends = [];

  for (const adapter of getAdapters()) {
    backends.push({
      id: adapter.id,
      available: await adapter.isAvailable(ctx),
      formats: adapter.formats,
    });
  }

  const diagnostics: Diagnostic[] = backends.map((backend) => {
    if (backend.available) {
      return {
        severity: "info",
        code: "backend-available",
        message: `${backend.id} is available.`,
      };
    }

    return {
      severity: "warning",
      code: "backend-missing",
      message: `${backend.id} is not available.`,
      hint: `Formats affected: ${backend.formats.join(", ")}`,
    };
  });

  return { diagnostics, backends };
}
