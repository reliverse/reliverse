import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { definePlugin } from "../api/define-plugin";
import { createFileCommandSource } from "./file-source";
import { discoverCommandPath } from "./discover-command";
import { RemptsUsageError } from "./errors";
import { createPluginCommandSource } from "./plugin-source";
import { resolveEntry } from "./resolve-entry";

const defineCommandModulePath = "/home/blefnk/dev/reliverse/reliverse/packages/rempts/src/api/define-command.ts";
const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rempts-test-"));
  tempRoots.push(root);
  return root;
}

async function writeCommandFile(
  filePath: string,
  options: { aliases?: readonly string[] | undefined; description: string; name: string },
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const aliases = JSON.stringify(options.aliases ?? []);
  await writeFile(
    filePath,
    [
      `import { defineCommand } from ${JSON.stringify(defineCommandModulePath)};`,
      "",
      "export default defineCommand({",
      "  meta: {",
      `    name: ${JSON.stringify(options.name)},`,
      `    description: ${JSON.stringify(options.description)},`,
      `    aliases: ${aliases},`,
      "  },",
      "  async handler() {",
      "    return undefined;",
      "  },",
      "});",
      "",
    ].join("\n"),
  );
}

async function createLocalSource(
  root: string,
  commands: ReadonlyArray<{ aliases?: readonly string[] | undefined; description: string; path: readonly string[] }>,
) {
  const entryPath = join(root, "cli.ts");
  await mkdir(root, { recursive: true });
  await writeFile(entryPath, "export {};\n");

  for (const command of commands) {
    const commandDir = join(root, "cmds", ...command.path);
    await writeCommandFile(join(commandDir, "cmd.ts"), {
      aliases: command.aliases,
      description: command.description,
      name: command.path.at(-1) ?? "root",
    });
  }

  return createFileCommandSource(resolveEntry(entryPath));
}

async function createPluginSource(
  root: string,
  pluginName: string,
  commands: ReadonlyArray<{ aliases?: readonly string[] | undefined; description: string; path: readonly string[] }>,
) {
  const entryPath = join(root, "src", "index.ts");
  await mkdir(dirname(entryPath), { recursive: true });
  await writeFile(entryPath, "export {};\n");

  for (const command of commands) {
    const commandDir = join(root, "src", "cmds", ...command.path);
    await writeCommandFile(join(commandDir, "cmd.ts"), {
      aliases: command.aliases,
      description: command.description,
      name: command.path.at(-1) ?? "root",
    });
  }

  return createPluginCommandSource(
    definePlugin({
      entry: entryPath,
      name: pluginName,
    }),
  );
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("discoverCommandPath precedence", () => {
  test("local commands win over plugins on the same exact node", async () => {
    const root = await createTempRoot();
    const local = await createLocalSource(join(root, "local"), [
      { description: "local dler", path: ["dler"] },
    ]);
    const plugin = await createPluginSource(join(root, "plugin-a"), "plugin-a", [
      { description: "plugin dler", path: ["dler"] },
      { description: "plugin build", path: ["dler", "build"] },
    ]);

    const discovered = await discoverCommandPath([local, plugin], ["dler"]);

    expect(discovered.commandNode?.description).toBe("local dler");
    expect(discovered.availableSubcommands.map((item) => item.name)).toEqual(["build"]);
  });

  test("earlier plugin wins over later plugin on the same exact node", async () => {
    const root = await createTempRoot();
    const pluginA = await createPluginSource(join(root, "plugin-a"), "plugin-a", [
      { description: "plugin A dler", path: ["dler"] },
    ]);
    const pluginB = await createPluginSource(join(root, "plugin-b"), "plugin-b", [
      { description: "plugin B dler", path: ["dler"] },
    ]);

    const discovered = await discoverCommandPath([pluginA, pluginB], ["dler"]);

    expect(discovered.commandNode?.description).toBe("plugin A dler");
  });

  test("deeper subcommands can merge in from later plugins", async () => {
    const root = await createTempRoot();
    const local = await createLocalSource(join(root, "local"), [
      { description: "local dler", path: ["dler"] },
    ]);
    const pluginA = await createPluginSource(join(root, "plugin-a"), "plugin-a", [
      { description: "plugin build", path: ["dler", "build"] },
      { description: "plugin pub", path: ["dler", "pub"] },
    ]);
    const pluginB = await createPluginSource(join(root, "plugin-b"), "plugin-b", [
      { description: "native binary", path: ["dler", "build", "native-binary"] },
      { description: "jsr publish", path: ["dler", "pub", "jsr"] },
      { description: "pack", path: ["dler", "pack"] },
    ]);

    const dler = await discoverCommandPath([local, pluginA, pluginB], ["dler"]);
    expect(dler.availableSubcommands.map((item) => item.name)).toEqual(["build", "pack", "pub"]);

    const build = await discoverCommandPath([local, pluginA, pluginB], ["dler", "build"]);
    expect(build.commandNode?.description).toBe("plugin build");
    expect(build.availableSubcommands.map((item) => item.name)).toEqual(["native-binary"]);

    const pub = await discoverCommandPath([local, pluginA, pluginB], ["dler", "pub"]);
    expect(pub.commandNode?.description).toBe("plugin pub");
    expect(pub.availableSubcommands.map((item) => item.name)).toEqual(["jsr"]);
  });

  test("ambiguous alias to different canonical names throws a hard error", async () => {
    const root = await createTempRoot();
    const pluginA = await createPluginSource(join(root, "plugin-a"), "plugin-a", [
      { aliases: ["shared"], description: "foo", path: ["foo"] },
    ]);
    const pluginB = await createPluginSource(join(root, "plugin-b"), "plugin-b", [
      { aliases: ["shared"], description: "bar", path: ["bar"] },
    ]);

    await expect(discoverCommandPath([pluginA, pluginB], ["shared"])).rejects.toBeInstanceOf(
      RemptsUsageError,
    );
  });
});
