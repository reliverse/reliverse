import { describe, expect, test } from "bun:test";

import { createCommandContext } from "./context";
import { createRuntimeOutput } from "./output";

function createBufferStream() {
  let text = "";

  return {
    get value() {
      return text;
    },
    write(chunk: string) {
      text += chunk;
      return true;
    },
  };
}

describe("runtime output colors", () => {
  test("exposes reliko instances on runtime output", () => {
    const stdout = createBufferStream();
    const stderr = createBufferStream();
    const output = createRuntimeOutput({ mode: "text", stderr, stdout });

    expect(output.colors.stdout.green("ok")).toContain("ok");
    expect(output.colors.stderr.red("bad")).toContain("bad");
  });

  test("command context exposes the shared color instances", () => {
    const stdout = createBufferStream();
    const stderr = createBufferStream();
    const output = createRuntimeOutput({ mode: "text", stderr, stdout });
    const context = createCommandContext({
      args: [],
      command: {
        aliases: [],
        examples: [],
        interactive: "never",
        name: "demo",
        noTTY: false,
        noTUI: false,
        path: ["demo"],
        sourceId: "local",
        sourceKind: "file",
      },
      confirmationMode: "disabled",
      cwd: ".",
      env: {},
      globalFlags: { help: false, interactive: false, json: false, noInput: false, tui: false },
      input: {} as never,
      interaction: {
        canPrompt: false,
        commandMode: "never",
        confirmationMode: "disabled",
        effectiveMode: "never",
        isNonInteractive: true,
        isTTY: false,
        isTUIAllowed: false,
        reason: "test",
        requestedHostMode: "never",
        stdinMode: "tty",
      },
      isTTY: false,
      isTUI: false,
      options: {},
      output,
      prompt: {} as never,
      stderr: stderr as never,
      stdin: {} as never,
      stdinMode: "tty",
      stdout: stdout as never,
    });

    expect(context.colors).toBe(output.colors);
  });
});
