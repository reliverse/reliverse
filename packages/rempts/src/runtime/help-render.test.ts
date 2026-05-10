import { describe, expect, test } from "bun:test";

import { createRelico } from "@reliverse/relico";

import { renderHelpDocument } from "./help-render";

describe("renderHelpDocument colors", () => {
  test("keeps plain rendering available without color helpers", () => {
    const text = renderHelpDocument({
      aliases: [],
      commandFlags: [],
      commandPath: [],
      examples: [],
      globalFlags: [],
      interactive: "never",
      programName: "demo",
      scope: "launcher",
      scopeLabel: "Commands",
      subcommands: [],
      usage: ["demo --help"],
    });

    expect(text).toContain("demo");
    expect(text).toContain("Usage");
    expect(text).toContain("Interaction");
  });

  test("colorizes headings and flag names when colors are enabled", () => {
    const text = renderHelpDocument(
      {
        aliases: [],
        commandFlags: [],
        commandPath: [],
        examples: [],
        globalFlags: [{ description: "Enable thing", names: "--demo" }],
        interactive: "never",
        programName: "demo",
        scope: "launcher",
        scopeLabel: "Commands",
        subcommands: [{ aliases: [], name: "ship" }],
        usage: ["demo --help"],
      },
      {
        body: createRelico({ color: true }),
        heading: createRelico({ color: true }),
      },
    );

    expect(text).toContain("\u001B[");
    expect(text).toContain("--demo");
    expect(text).toContain("Commands");
    expect(text).toContain("agent-first command runner");
  });

  test("aligns command and flag rows in a bun-like two-column layout", () => {
    const text = renderHelpDocument({
      aliases: [],
      commandFlags: [{ description: "First flag", names: "--alpha" }],
      commandPath: [],
      examples: [],
      globalFlags: [{ description: "Second flag", names: "-h, --help" }],
      interactive: "never",
      programName: "demo",
      scope: "launcher",
      scopeLabel: "Commands",
      subcommands: [
        { aliases: ["ship"], description: "Run the deploy flow", name: "deploy" },
        { aliases: [], description: "Print diagnostics", name: "doctor" },
      ],
      usage: ["demo <command>"],
    });

    expect(text).toContain("deploy  Run the deploy flow (aliases: ship)");
    expect(text).toContain("doctor  Print diagnostics");
    expect(text).toContain("-h, --help  Second flag");
  });

  test("renders false default values instead of treating them as absent", () => {
    const text = renderHelpDocument({
      aliases: [],
      commandFlags: [
        { defaultValue: "false", description: "Do the careful thing", names: "--careful" },
      ],
      commandPath: [],
      examples: [],
      globalFlags: [],
      interactive: "never",
      programName: "demo",
      scope: "launcher",
      scopeLabel: "Commands",
      subcommands: [],
      usage: ["demo <command>"],
    });

    expect(text).toContain("default: false");
  });

  test("adds section rules and prompt-like usage/examples without breaking plain output", () => {
    const text = renderHelpDocument({
      aliases: [],
      commandFlags: [],
      commandPath: [],
      examples: ["demo ship"],
      globalFlags: [],
      interactive: "never",
      programName: "demo",
      scope: "launcher",
      scopeLabel: "Commands",
      subcommands: [],
      usage: ["demo <command>"],
    });

    expect(text).toContain("Examples ────────────");
    expect(text).toContain("$ demo ship");
    expect(text).toContain("- demo <command>");
  });

  test("wraps long descriptions without destroying the aligned layout", () => {
    const text = renderHelpDocument({
      aliases: [],
      commandFlags: [
        {
          description:
            "This is a very long description that should wrap onto another line while keeping the command flag column visually stable for humans reading help output in a terminal.",
          names: "--alpha",
        },
      ],
      commandPath: [],
      examples: [],
      globalFlags: [],
      interactive: "never",
      programName: "demo",
      scope: "launcher",
      scopeLabel: "Commands",
      subcommands: [],
      usage: ["demo <command>"],
    });

    expect(text).toContain("--alpha");
    expect(text).toContain(
      "This is a very long description that should wrap onto another line while",
    );
    expect(text).toContain(
      "keeping the command flag column visually stable for humans reading help",
    );
    expect(text).toContain("output in a terminal.");
  });

  test("preserves multiline help prose and bullet structure", () => {
    const text = renderHelpDocument({
      aliases: [],
      commandFlags: [],
      commandPath: [],
      examples: [],
      globalFlags: [],
      helpText: [
        "No commands are currently available in this CLI.",
        "",
        "End user tips:",
        "- run this CLI inside the intended project/workspace",
        "- install or enable the plugin packages expected by this CLI",
      ].join("\n"),
      interactive: "never",
      programName: "demo",
      scope: "launcher",
      scopeLabel: "Commands",
      subcommands: [],
      usage: ["demo <command>"],
    });

    expect(text).toContain("No commands are currently available in this CLI.");
    expect(text).toContain("End user tips:");
    expect(text).toContain("- run this CLI inside the intended project/workspace");
    expect(text).toContain("- install or enable the plugin packages expected by this CLI");
  });
});
