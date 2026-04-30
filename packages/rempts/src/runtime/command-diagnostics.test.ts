import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { definePlugin, REMPTS_PLUGIN_API_VERSION } from "../api/define-plugin";
import { inspectCommandTree } from "./command-diagnostics";
import { createFileCommandSource } from "./file-source";
import { createPluginCommandSource } from "./plugin-source";
import { resolveEntry } from "./resolve-entry";

const defineCommandModulePath =
  "/home/blefnk/dev/reliverse/reliverse/packages/rempts/src/api/define-command.ts";

async function writeCommandFile(
  filePath: string,
  name: string,
  description: string,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    [
      `import { defineCommand } from ${JSON.stringify(defineCommandModulePath)};`,
      "",
      "export default defineCommand({",
      "  meta: {",
      `    name: ${JSON.stringify(name)},`,
      `    description: ${JSON.stringify(description)},`,
      "  },",
      "  async handler() {",
      "    return undefined;",
      "  },",
      "});",
      "",
    ].join("\n"),
  );
}

async function createLocalSource(root: string) {
  const entryPath = join(root, "cli.ts");
  await mkdir(root, { recursive: true });
  await writeFile(entryPath, "export {};\n");
  await writeCommandFile(join(root, "cmds", "dler", "cmd.ts"), "dler", "local dler");
  return createFileCommandSource(resolveEntry(entryPath));
}

async function createPluginSource(root: string, pluginName: string, commands: readonly string[][]) {
  const entryPath = join(root, "src", "index.ts");
  await mkdir(dirname(entryPath), { recursive: true });
  await writeFile(entryPath, "export {};\n");
  for (const path of commands) {
    await writeCommandFile(
      join(root, "src", "cmds", ...path, "cmd.ts"),
      path.at(-1) ?? "cmd",
      `${pluginName} ${path.join("/")}`,
    );
  }
  return createPluginCommandSource(
    definePlugin({ apiVersion: REMPTS_PLUGIN_API_VERSION, entry: entryPath, name: pluginName }),
  );
}

describe("inspectCommandTree", () => {
  test("reports chosen and shadowed command nodes plus merged subcommands", async () => {
    const root = await mkdtemp(join(tmpdir(), "rempts-command-diag-"));
    const local = await createLocalSource(join(root, "local"));
    const pluginA = await createPluginSource(join(root, "plugin-a"), "plugin-a", [
      ["dler"],
      ["dler", "build"],
    ]);
    const pluginB = await createPluginSource(join(root, "plugin-b"), "plugin-b", [
      ["dler"],
      ["dler", "pub"],
    ]);

    const report = await inspectCommandTree([local, pluginA, pluginB]);
    const dler = report.nodes.find((node) => node.path.join("/") === "dler");

    expect(dler).toBeDefined();
    expect(dler?.chosenCommand?.sourceId).toBe("local");
    expect(dler?.shadowedCommands.map((entry) => entry.sourceId)).toEqual(["plugin-a", "plugin-b"]);
    expect(dler?.availableSubcommands).toEqual(["build", "pub"]);
  });
});
