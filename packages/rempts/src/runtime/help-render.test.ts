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
        subcommands: [{ name: "ship" }],
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
        { description: "Run the deploy flow", name: "deploy" },
        { description: "Print diagnostics", name: "doctor" },
      ],
      usage: ["demo <command>"],
    });

    expect(text).toContain("deploy  Run the deploy flow");
    expect(text).toContain("doctor  Print diagnostics");
    expect(text).toContain("-h, --help  Second flag");
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
      commandFlags: [{ description: "This is a very long description that should wrap onto another line while keeping the command flag column visually stable for humans reading help output in a terminal.", names: "--alpha" }],
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
    expect(text).toContain("This is a very long description that should wrap onto another line while");
    expect(text).toContain("keeping the command flag column visually stable for humans reading help");
    expect(text).toContain("output in a terminal.");
  });
});
