import { describe, expect, test } from "bun:test";

import { getPromptUnavailableMessage, resolveInteractionPolicy } from "./noninteractive";

function createTTYInput(isTTY: boolean) {
  return { isTTY } as typeof process.stdin;
}

function createTTYOutput(isTTY: boolean) {
  return { isTTY } as unknown as typeof process.stdout;
}

describe("resolveInteractionPolicy", () => {
  test("defaults to non-interactive even when TTY is available", () => {
    const policy = resolveInteractionPolicy({
      commandMode: "never",
      env: {},
      hostMode: "never",
      stdin: createTTYInput(true),
      stdout: createTTYOutput(true),
    });

    expect(policy.requestedHostMode).toBe("never");
    expect(policy.commandMode).toBe("never");
    expect(policy.effectiveMode).toBe("never");
    expect(policy.canPrompt).toBe(false);
    expect(policy.isNonInteractive).toBe(true);
  });

  test("allows tty prompts only when host and command both allow them", () => {
    const policy = resolveInteractionPolicy({
      commandMode: "tty",
      env: {},
      hostMode: "tty",
      stdin: createTTYInput(true),
      stdout: createTTYOutput(true),
    });

    expect(policy.effectiveMode).toBe("tty");
    expect(policy.canPrompt).toBe(true);
    expect(policy.isTUIAllowed).toBe(false);
  });

  test("tui host mode narrows to tty when command only allows tty", () => {
    const policy = resolveInteractionPolicy({
      commandMode: "tty",
      env: {},
      hostMode: "tui",
      stdin: createTTYInput(true),
      stdout: createTTYOutput(true),
    });

    expect(policy.effectiveMode).toBe("tty");
    expect(policy.canPrompt).toBe(true);
    expect(policy.isTUIAllowed).toBe(false);
  });

  test("tui opt-in enables tui when command allows it", () => {
    const policy = resolveInteractionPolicy({
      commandMode: "tui",
      env: {},
      hostMode: "never",
      stdin: createTTYInput(true),
      stdout: createTTYOutput(true),
      tui: true,
    });

    expect(policy.requestedHostMode).toBe("tui");
    expect(policy.effectiveMode).toBe("tui");
    expect(policy.canPrompt).toBe(true);
    expect(policy.isTUIAllowed).toBe(true);
  });

  test("interactive opt-in does not override a never command", () => {
    const policy = resolveInteractionPolicy({
      commandMode: "never",
      env: {},
      hostMode: "never",
      interactive: true,
      stdin: createTTYInput(true),
      stdout: createTTYOutput(true),
    });

    expect(policy.requestedHostMode).toBe("tty");
    expect(policy.effectiveMode).toBe("never");
    expect(policy.canPrompt).toBe(false);
  });

  test("ci disables interaction even when host and command allow it", () => {
    const policy = resolveInteractionPolicy({
      commandMode: "tui",
      env: { CI: "1" },
      hostMode: "tui",
      stdin: createTTYInput(true),
      stdout: createTTYOutput(true),
    });

    expect(policy.effectiveMode).toBe("never");
    expect(policy.canPrompt).toBe(false);
    expect(policy.reason).toContain("CI");
  });

  test("non-tty environment disables interaction", () => {
    const policy = resolveInteractionPolicy({
      commandMode: "tty",
      env: {},
      hostMode: "tty",
      stdin: createTTYInput(false),
      stdout: createTTYOutput(false),
    });

    expect(policy.isTTY).toBe(false);
    expect(policy.effectiveMode).toBe("never");
    expect(policy.canPrompt).toBe(false);
  });

  test("no-input is absolute", () => {
    const policy = resolveInteractionPolicy({
      commandMode: "tui",
      env: {},
      hostMode: "tui",
      noInput: true,
      stdin: createTTYInput(true),
      stdout: createTTYOutput(true),
      tui: true,
    });

    expect(policy.requestedHostMode).toBe("never");
    expect(policy.effectiveMode).toBe("never");
    expect(policy.canPrompt).toBe(false);
  });

  test("legacy noTUI compatibility maps to tty command mode", () => {
    const policy = resolveInteractionPolicy({
      env: {},
      hostMode: "tui",
      noTUI: true,
      stdin: createTTYInput(true),
      stdout: createTTYOutput(true),
    });

    expect(policy.commandMode).toBe("tty");
    expect(policy.effectiveMode).toBe("tty");
    expect(policy.isTUIAllowed).toBe(false);
  });

  test("legacy noTTY compatibility maps to never command mode", () => {
    const policy = resolveInteractionPolicy({
      env: {},
      hostMode: "tui",
      noTTY: true,
      stdin: createTTYInput(true),
      stdout: createTTYOutput(true),
    });

    expect(policy.commandMode).toBe("never");
    expect(policy.effectiveMode).toBe("never");
    expect(policy.canPrompt).toBe(false);
  });

  test("prompt unavailable message suggests host opt-in when command could prompt", () => {
    const policy = resolveInteractionPolicy({
      commandMode: "tty",
      env: {},
      hostMode: "never",
      stdin: createTTYInput(true),
      stdout: createTTYOutput(true),
    });

    expect(getPromptUnavailableMessage("name", policy)).toContain("--interactive or --tui");
  });

  test("prompt unavailable message explains when command disallows prompts", () => {
    const policy = resolveInteractionPolicy({
      commandMode: "never",
      env: {},
      hostMode: "tty",
      stdin: createTTYInput(true),
      stdout: createTTYOutput(true),
      interactive: true,
    });

    expect(getPromptUnavailableMessage("name", policy)).toContain("does not allow interactive prompts");
  });
});
