import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createCLI } from "./create-cli";

function createBufferStream() {
  const chunks: string[] = [];

  return {
    stream: {
      isTTY: false,
      write(value: string) {
        chunks.push(value);
        return true;
      },
    },
    text() {
      return chunks.join("");
    },
  };
}

describe("createCLI", () => {
  test("shows launcher help instead of failing when plugin discovery is enabled but no plugins are installed", async () => {
    const root = await mkdtemp(join(tmpdir(), "rempts-empty-cli-"));
    const entryPath = join(root, "cli.ts");
    await writeFile(entryPath, "#!/usr/bin/env bun\n", "utf8");

    const stdout = createBufferStream();
    const stderr = createBufferStream();
    const result = await createCLI({
      argv: [],
      cwd: root,
      entry: entryPath,
      meta: {
        description: "Test CLI",
        name: "empty-cli-test",
      },
      plugins: {
        allowedPatterns: ["@example/*-plugin"],
      },
      stdin: { isTTY: false } as never,
      stdout: stdout.stream as never,
      stderr: stderr.stream as never,
    });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(stderr.text()).toBe("");
    expect(stdout.text()).toContain("empty-cli-test");
    expect(stdout.text()).toContain("No commands are currently available in this CLI.");
    expect(stdout.text()).toContain("install or enable the plugin packages expected by this CLI");
    expect(stdout.text()).toContain(`add local command files under ${join(root, "cmds")}`);
    expect(stdout.text()).not.toContain("No Rempts host plugins found");
  });

  test("help flag still returns launcher help for an empty CLI with plugin discovery enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "rempts-empty-cli-"));
    const entryPath = join(root, "cli.ts");
    await writeFile(entryPath, "#!/usr/bin/env bun\n", "utf8");

    const stdout = createBufferStream();
    const result = await createCLI({
      argv: ["--help"],
      cwd: root,
      entry: entryPath,
      meta: {
        description: "Test CLI",
        name: "empty-cli-help-test",
      },
      plugins: {
        allowedPatterns: ["@example/*-plugin"],
      },
      stdin: { isTTY: false } as never,
      stdout: stdout.stream as never,
      stderr: createBufferStream().stream as never,
    });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(stdout.text()).toContain("Usage");
    expect(stdout.text()).toContain("No commands are currently available in this CLI.");
  });

  test("launcher help for an empty CLI without plugin discovery still includes developer guidance", async () => {
    const root = await mkdtemp(join(tmpdir(), "rempts-empty-cli-"));
    const entryPath = join(root, "cli.ts");
    await mkdir(join(root, "cmds"), { recursive: true });
    await writeFile(entryPath, "#!/usr/bin/env bun\n", "utf8");

    const stdout = createBufferStream();
    const result = await createCLI({
      argv: [],
      cwd: root,
      entry: entryPath,
      meta: {
        description: "Test CLI",
        name: "empty-local-cli-test",
      },
      stdin: { isTTY: false } as never,
      stdout: stdout.stream as never,
      stderr: createBufferStream().stream as never,
    });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(stdout.text()).toContain("No commands are currently available in this CLI.");
    expect(stdout.text()).toContain(`add local command files under ${join(root, "cmds")}`);
    expect(stdout.text()).not.toContain("install or enable the plugin packages expected by this CLI");
  });

  test("rejects plugin discovery config when allowedPatterns is empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "rempts-empty-cli-"));
    const entryPath = join(root, "cli.ts");
    await writeFile(entryPath, "#!/usr/bin/env bun\n", "utf8");

    const stderr = createBufferStream();

    const result = await createCLI({
      argv: [],
      cwd: root,
      entry: entryPath,
      meta: {
        description: "Test CLI",
        name: "invalid-plugin-config-test",
      },
      plugins: {},
      stdin: { isTTY: false } as never,
      stdout: createBufferStream().stream as never,
      stderr: stderr.stream as never,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(stderr.text()).toContain("plugins is configured, but plugins.allowedPatterns is empty");
  });

  test("merges inherited CLI options into command parsing while letting command-local definitions win", async () => {
    const root = await mkdtemp(join(tmpdir(), "rempts-inherited-options-"));
    const entryPath = join(root, "cli.ts");
    const commandDir = join(root, "cmds", "demo");
    await mkdir(commandDir, { recursive: true });
    await writeFile(entryPath, "#!/usr/bin/env bun\n", "utf8");
    await writeFile(
      join(commandDir, "cmd.ts"),
      [
        'import { defineCommand } from "/home/blefnk/dev/reliverse/reliverse/packages/rempts/src/index.ts";',
        "",
        "export default defineCommand({",
        "  options: {",
        "    shared: { type: \"string\", description: \"command override\" },",
        "    commandOnly: { type: \"boolean\" },",
        "  },",
        "  async handler(ctx) {",
        "    ctx.out(JSON.stringify(ctx.options));",
        "  },",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );

    const stdout = createBufferStream();
    const result = await createCLI({
      argv: ["demo", "--shared", "leaf-value", "--cli-only"],
      cwd: root,
      entry: entryPath,
      meta: {
        name: "inherited-option-test",
      },
      options: {
        cliOnly: { type: "boolean", description: "cli inherited option" },
        shared: { type: "boolean", description: "cli definition that should be overridden" },
      },
      stdin: { isTTY: false } as never,
      stdout: stdout.stream as never,
      stderr: createBufferStream().stream as never,
    });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(stdout.text()).toContain('"cliOnly":true');
    expect(stdout.text()).toContain('"shared":"leaf-value"');
  });
});
