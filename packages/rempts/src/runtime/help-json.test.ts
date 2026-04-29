import { describe, expect, test } from "bun:test";

import { defineCommand } from "../api/define-command";
import { getGlobalFlagDefinitions } from "./global-flags";
import { serializeHelpDocument } from "./help-json";
import { buildCommandHelpDocument, buildLauncherHelpDocument } from "./help-model";

describe("help JSON contract", () => {
  test("launcher help JSON includes explicit non-interactive default", () => {
    const globalFlags = getGlobalFlagDefinitions();
    const document = buildLauncherHelpDocument({
      availableSubcommands: [{ description: "Example command", name: "example" }],
      commandPath: [],
      description: "Example automation-first CLI",
      examples: ["example-cli example --help"],
      globalFlagDefinitions: globalFlags,
      interactive: "never",
      programName: "example-cli",
    });
    const serialized = serializeHelpDocument(document);

    expect(serialized.ok).toBe(true);
    expect(serialized.remptsHelp).toBe(1);
    expect(serialized.schemaVersion).toBe(1);
    expect(serialized.scope).toBe("launcher");
    expect(serialized.interactive).toBe("never");
    expect(serialized.globalFlags.map((flag) => flag.names)).toContain("-i, --interactive");
    expect(serialized.globalFlags.map((flag) => flag.names)).toContain("--tui");
  });

  test("command help JSON preserves command interaction mode and flags", () => {
    const globalFlags = getGlobalFlagDefinitions();
    const command = defineCommand({
      meta: {
        name: "deploy",
        description: "Deploy something safely",
        aliases: ["ship"],
      },
      interactive: "tui",
      help: {
        examples: ["example-cli deploy", "example-cli deploy --apply"],
        text: "Preview by default; use apply to mutate.",
      },
      options: {
        target: {
          type: "string",
          description: "Deployment target.",
          inputSources: ["flag"],
        },
      },
      safety: {
        defaultMode: "preview",
        requiresApply: true,
        effects: ["network.publish"],
      },
      conventions: {
        supportsApply: true,
      },
      async handler() {
        return undefined;
      },
    });

    const document = buildCommandHelpDocument({
      availableSubcommands: [],
      command,
      commandPath: ["deploy"],
      globalFlagDefinitions: globalFlags,
      programName: "example-cli",
    });
    const serialized = serializeHelpDocument(document);

    expect(serialized.scope).toBe("command");
    expect(serialized.interactive).toBe("tui");
    expect(serialized.aliases).toEqual(["ship"]);
    expect(serialized.usage).toEqual(["example-cli deploy [global-flags] [command-flags] [args]"]);
    expect(serialized.commandFlags).toHaveLength(1);
    expect(serialized.commandFlags[0]?.names).toContain("--target");
    expect(serialized.safety?.requiresApply).toBe(true);
    expect(serialized.helpText).toBe("Preview by default; use apply to mutate.");
  });

  test("launcher help JSON for nested scope carries explicit interaction policy", () => {
    const globalFlags = getGlobalFlagDefinitions();
    const document = buildLauncherHelpDocument({
      availableSubcommands: [{ description: "Publish artifacts", name: "publish" }],
      commandPath: ["dler"],
      description: "Builder scope",
      globalFlagDefinitions: globalFlags,
      interactive: "tty",
      programName: "example-cli",
    });
    const serialized = serializeHelpDocument(document);

    expect(serialized.scope).toBe("launcher");
    expect(serialized.scopeLabel).toBe("Subcommands");
    expect(serialized.usage).toEqual(["example-cli dler <subcommand> [command-flags]"]);
    expect(serialized.interactive).toBe("tty");
    expect(serialized.subcommands[0]).toEqual({
      description: "Publish artifacts",
      name: "publish",
    });
  });
});
