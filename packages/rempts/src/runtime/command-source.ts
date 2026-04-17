import type {
  CommandAgentMetadata,
  CommandConventions,
  CommandDefinition,
} from "../api/define-command";
import type { CommandOptionsRecord } from "../options/types";

export interface DiscoveredSubcommand {
  readonly description?: string | undefined;
  readonly name: string;
}

export interface CommandNodeMetadata {
  readonly agent?: CommandAgentMetadata | undefined;
  readonly aliases: readonly string[];
  readonly conventions?: CommandConventions | undefined;
  readonly description?: string | undefined;
  readonly examples: readonly string[];
  readonly help?: string | undefined;
  readonly interactive?: "never" | "tty" | "tui" | undefined;
  readonly name: string;
  readonly path: readonly string[];
}

export interface CommandNode extends CommandNodeMetadata {
  readonly directoryPath?: string | undefined;
  readonly filePath?: string | undefined;
  readonly loadCommand?: (() => Promise<CommandDefinition<CommandOptionsRecord>>) | undefined;
  readonly sourceId: string;
  readonly sourceKind: "file" | "plugin";
}

export interface CommandSourceScope {
  readonly node: CommandNode | null;
  readonly subcommands: readonly DiscoveredSubcommand[];
  resolveSegment(segment: string): Promise<string | null>;
}

export interface CommandSource {
  readonly id: string;
  getScope(path: readonly string[]): Promise<CommandSourceScope | null>;
}
