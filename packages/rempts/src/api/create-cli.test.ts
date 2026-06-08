import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    expect(stdout.text()).toStartWith("\n");
    expect(stdout.text()).toContain("Usage");
    expect(stdout.text()).toContain("No commands are currently available in this CLI.");
    expect(stdout.text()).toEndWith("\n\n");
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
    expect(stdout.text()).not.toContain(
      "install or enable the plugin packages expected by this CLI",
    );
  });

  test("unknown top-level plugin-name command suggests plugin-provided commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "rempts-plugin-name-hint-"));
    const entryPath = join(root, "cli.ts");
    const pluginRoot = join(root, "node_modules", "@example", "dler-rse-plugin");
    await mkdir(join(pluginRoot, "cmds", "build"), { recursive: true });
    await mkdir(join(pluginRoot, "cmds", "pub"), { recursive: true });
    await writeFile(entryPath, "#!/usr/bin/env bun\n", "utf8");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ devDependencies: { "@example/dler-rse-plugin": "1.0.0" } }),
      "utf8",
    );
    await writeFile(
      join(pluginRoot, "package.json"),
      JSON.stringify({
        name: "@example/dler-rse-plugin",
        type: "module",
        exports: "./index.ts",
        dependencies: { "@reliverse/rempts": "1.0.0" },
      }),
      "utf8",
    );
    await writeFile(
      join(pluginRoot, "index.ts"),
      [
        'import { definePlugin, REMPTS_PLUGIN_API_VERSION } from "/home/blefnk/dev/reliverse/reliverse/packages/rempts/src/index.ts";',
        "export default definePlugin({",
        "  apiVersion: REMPTS_PLUGIN_API_VERSION,",
        "  entry: import.meta.url,",
        "  name: 'dler-rse-plugin',",
        "});",
      ].join("\n"),
      "utf8",
    );
    const commandFile = [
      'import { defineCommand } from "/home/blefnk/dev/reliverse/reliverse/packages/rempts/src/index.ts";',
      "export default defineCommand({ async handler(ctx) { ctx.out('ok'); } });",
    ].join("\n");
    await writeFile(join(pluginRoot, "cmds", "build", "cmd.ts"), commandFile, "utf8");
    await writeFile(join(pluginRoot, "cmds", "pub", "cmd.ts"), commandFile, "utf8");

    const jsonStderr = createBufferStream();
    const jsonResult = await createCLI({
      argv: ["dler", "pub"],
      cwd: root,
      entry: entryPath,
      meta: { name: "rse" },
      outputMode: "json",
      plugins: { allowedPatterns: ["@example/*-rse-plugin"] },
      stdin: { isTTY: false } as never,
      stdout: createBufferStream().stream as never,
      stderr: jsonStderr.stream as never,
    });

    expect(jsonResult.ok).toBe(false);
    expect(jsonResult.exitCode).toBe(1);
    const error = JSON.parse(jsonStderr.text()) as { hint?: string; message?: string };
    expect(error.message).toBe('Unknown command "dler".');
    expect(error.hint).toBe(
      'Plugin "dler-rse-plugin" is loaded, but "dler" is not a command namespace. Maybe you meant: rse pub?',
    );

    const textStderr = createBufferStream();
    const textResult = await createCLI({
      argv: ["dler", "pub"],
      cwd: root,
      entry: entryPath,
      meta: { name: "rse" },
      plugins: { allowedPatterns: ["@example/*-rse-plugin"] },
      stdin: { isTTY: false } as never,
      stdout: createBufferStream().stream as never,
      stderr: textStderr.stream as never,
    });

    expect(textResult.ok).toBe(false);
    expect(textResult.exitCode).toBe(1);
    expect(textStderr.text()).toContain('Hint: Plugin "dler-rse-plugin" is loaded');
    expect(textStderr.text()).not.toContain("Usage");
    expect(textStderr.text()).not.toContain("Commands");
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
        '    shared: { type: "string", description: "command override" },',
        '    commandOnly: { type: "boolean" },',
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

  test("reads env-backed options and honors inputSources", async () => {
    const root = await mkdtemp(join(tmpdir(), "rempts-env-options-"));
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
        '    token: { type: "string", env: "REMPTS_TEST_TOKEN", inputSources: ["env"] },',
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
      argv: ["demo"],
      cwd: root,
      entry: entryPath,
      env: { ...process.env, REMPTS_TEST_TOKEN: "from-env" },
      meta: {
        name: "env-option-test",
      },
      stdin: { isTTY: false } as never,
      stdout: stdout.stream as never,
      stderr: createBufferStream().stream as never,
    });

    expect(result.ok).toBe(true);
    expect(stdout.text()).toContain('"token":"from-env"');

    const stderr = createBufferStream();
    const rejected = await createCLI({
      argv: ["demo", "--token", "from-flag"],
      cwd: root,
      entry: entryPath,
      env: { ...process.env, REMPTS_TEST_TOKEN: "from-env" },
      meta: {
        name: "env-option-test",
      },
      stdin: { isTTY: false } as never,
      stdout: createBufferStream().stream as never,
      stderr: stderr.stream as never,
    });

    expect(rejected.ok).toBe(false);
    expect(stderr.text()).toContain('Option "--token" does not accept flag input.');
  });
});

test("injects --apply for commands that require apply and exposes ctx.safety", async () => {
  const root = await mkdtemp(join(tmpdir(), "rempts-apply-safety-"));
  const entryPath = join(root, "cli.ts");
  const commandDir = join(root, "cmds", "danger");
  await mkdir(commandDir, { recursive: true });
  await writeFile(entryPath, "#!/usr/bin/env bun\n", "utf8");
  await writeFile(
    join(commandDir, "cmd.ts"),
    [
      'import { defineCommand } from "/home/blefnk/dev/reliverse/reliverse/packages/rempts/src/index.ts";',
      "",
      "export default defineCommand({",
      "  safety: { defaultMode: 'preview', requiresApply: true, effects: ['fs.delete'] },",
      "  async handler(ctx) {",
      "    ctx.out(JSON.stringify({ apply: ctx.safety.apply, preview: ctx.safety.preview, effects: ctx.safety.effects }));",
      "  },",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  const previewStdout = createBufferStream();
  const previewResult = await createCLI({
    argv: ["danger"],
    cwd: root,
    entry: entryPath,
    meta: { name: "apply-safety-test" },
    stdin: { isTTY: false } as never,
    stdout: previewStdout.stream as never,
    stderr: createBufferStream().stream as never,
  });

  expect(previewResult.ok).toBe(true);
  expect(previewStdout.text()).toContain('"apply":false');
  expect(previewStdout.text()).toContain('"preview":true');
  expect(previewStdout.text()).toContain('"fs.delete"');

  const applyStdout = createBufferStream();
  const applyResult = await createCLI({
    argv: ["danger", "--apply"],
    cwd: root,
    entry: entryPath,
    meta: { name: "apply-safety-test" },
    stdin: { isTTY: false } as never,
    stdout: applyStdout.stream as never,
    stderr: createBufferStream().stream as never,
  });

  expect(applyResult.ok).toBe(true);
  expect(applyStdout.text()).toContain('"apply":true');
  expect(applyStdout.text()).toContain('"preview":false');
});

test("ctx.safety.assertApplied blocks side effects without --apply", async () => {
  const root = await mkdtemp(join(tmpdir(), "rempts-apply-guard-"));
  const entryPath = join(root, "cli.ts");
  const commandDir = join(root, "cmds", "danger");
  await mkdir(commandDir, { recursive: true });
  await writeFile(entryPath, "#!/usr/bin/env bun\n", "utf8");
  await writeFile(
    join(commandDir, "cmd.ts"),
    [
      'import { defineCommand } from "/home/blefnk/dev/reliverse/reliverse/packages/rempts/src/index.ts";',
      "",
      "export default defineCommand({",
      "  safety: { defaultMode: 'preview', requiresApply: true, effects: ['fs.delete'] },",
      "  async handler(ctx) {",
      "    ctx.safety.assertApplied('fs.delete');",
      "    ctx.out('deleted');",
      "  },",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  const stderr = createBufferStream();
  const blocked = await createCLI({
    argv: ["danger"],
    cwd: root,
    entry: entryPath,
    meta: { name: "apply-guard-test" },
    stdin: { isTTY: false } as never,
    stdout: createBufferStream().stream as never,
    stderr: stderr.stream as never,
  });

  expect(blocked.ok).toBe(false);
  expect(blocked.exitCode).toBe(1);
  expect(stderr.text()).toContain("requires --apply");

  const stdout = createBufferStream();
  const applied = await createCLI({
    argv: ["danger", "--apply"],
    cwd: root,
    entry: entryPath,
    meta: { name: "apply-guard-test" },
    stdin: { isTTY: false } as never,
    stdout: stdout.stream as never,
    stderr: createBufferStream().stream as never,
  });

  expect(applied.ok).toBe(true);
  expect(stdout.text()).toContain("deleted");
});

test("fails fast when a command defines a Rempts-reserved option", async () => {
  const root = await mkdtemp(join(tmpdir(), "rempts-reserved-command-option-"));
  const entryPath = join(root, "cli.ts");
  const commandDir = join(root, "cmds", "bad");
  await mkdir(commandDir, { recursive: true });
  await writeFile(entryPath, "#!/usr/bin/env bun\n", "utf8");
  await writeFile(
    join(commandDir, "cmd.ts"),
    [
      'import { defineCommand } from "/home/blefnk/dev/reliverse/reliverse/packages/rempts/src/index.ts";',
      "",
      "export default defineCommand({",
      "  options: { apply: { type: 'boolean' }, help: { type: 'boolean' }, json: { type: 'boolean' } },",
      "  async handler() { return undefined; },",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  const stderr = createBufferStream();
  const result = await createCLI({
    argv: ["bad"],
    cwd: root,
    entry: entryPath,
    meta: { name: "reserved-command-option-test" },
    stdin: { isTTY: false } as never,
    stdout: createBufferStream().stream as never,
    stderr: stderr.stream as never,
  });

  expect(result.ok).toBe(false);
  expect(stderr.text()).toContain(
    "Command options --apply, --help, and --json are reserved by Rempts",
  );
  expect(stderr.text()).toContain("safety.requiresApply");
  expect(stderr.text()).toContain("Help is handled by the Rempts runtime");
  expect(stderr.text()).toContain("JSON output is handled by the Rempts runtime");
});

test("fails fast when a boolean command option would generate a --no-no flag", async () => {
  const root = await mkdtemp(join(tmpdir(), "rempts-double-negative-option-"));
  const entryPath = join(root, "cli.ts");
  const commandDir = join(root, "cmds", "bad");
  await mkdir(commandDir, { recursive: true });
  await writeFile(entryPath, "#!/usr/bin/env bun\n", "utf8");
  await writeFile(
    join(commandDir, "cmd.ts"),
    [
      'import { defineCommand } from "/home/blefnk/dev/reliverse/reliverse/packages/rempts/src/index.ts";',
      "",
      "export default defineCommand({",
      "  options: { noMajor: { type: 'boolean', description: 'bad negative flag' } },",
      "  async handler() { return undefined; },",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  const stderr = createBufferStream();
  const result = await createCLI({
    argv: ["bad"],
    cwd: root,
    entry: entryPath,
    meta: { name: "double-negative-option-test" },
    stdin: { isTTY: false } as never,
    stdout: createBufferStream().stream as never,
    stderr: stderr.stream as never,
  });

  expect(result.ok).toBe(false);
  expect(stderr.text()).toContain("Command boolean option --no-major starts with --no-");
  expect(stderr.text()).toContain("would generate invalid double-negative --no-no-major");
  expect(stderr.text()).toContain("Define boolean options in positive form instead");
  expect(stderr.text()).toContain('use `major: { type: "boolean", defaultValue: true }`');
});

test("fails fast when inherited CLI options define Rempts-reserved flags", async () => {
  const root = await mkdtemp(join(tmpdir(), "rempts-reserved-cli-option-"));
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
      "  async handler() { return undefined; },",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  const stderr = createBufferStream();
  const result = await createCLI({
    argv: ["demo"],
    cwd: root,
    entry: entryPath,
    meta: { name: "reserved-cli-option-test" },
    options: {
      help: { type: "boolean" },
      json: { type: "boolean" },
    },
    stdin: { isTTY: false } as never,
    stdout: createBufferStream().stream as never,
    stderr: stderr.stream as never,
  });

  expect(result.ok).toBe(false);
  expect(stderr.text()).toContain("CLI inherited options --help and --json are reserved by Rempts");
  expect(stderr.text()).toContain("Help is handled by the Rempts runtime");
});
