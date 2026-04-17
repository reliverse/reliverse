import { resolveEntry } from "../runtime/resolve-entry";
import { RemptsUsageError } from "../runtime/errors";

export interface RemptsPlugin {
  readonly description?: string | undefined;
  readonly entry: string;
  readonly name: string;
}

function assertValidSegment(segment: string, path: readonly string[]): void {
  if (segment.length === 0) {
    throw new RemptsUsageError(
      `Plugin command path "${path.join(" ")}" contains an empty segment.`,
    );
  }

  if (segment.startsWith("-")) {
    throw new RemptsUsageError(
      `Plugin command path "${path.join(" ")}" contains invalid segment "${segment}".`,
    );
  }
}

export function definePlugin(plugin: RemptsPlugin): RemptsPlugin {
  assertValidSegment(plugin.name, [plugin.name]);
  resolveEntry(plugin.entry);

  return {
    description: plugin.description,
    entry: plugin.entry,
    name: plugin.name,
  };
}
