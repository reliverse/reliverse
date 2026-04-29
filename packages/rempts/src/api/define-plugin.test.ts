import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { definePlugin, REMPTS_PLUGIN_API_VERSION } from "./define-plugin";
import { RemptsUsageError } from "../runtime/errors";

describe("definePlugin", () => {
  test("accepts the current plugin api version", async () => {
    const root = await mkdtemp(join(tmpdir(), "rempts-plugin-"));
    const entry = join(root, "index.ts");
    await writeFile(entry, "export {};\n", "utf8");

    expect(
      definePlugin({
        apiVersion: REMPTS_PLUGIN_API_VERSION,
        entry,
        name: "demo-plugin",
        options: {
          target: {
            type: "string",
          },
        },
      }),
    ).toMatchObject({
      apiVersion: REMPTS_PLUGIN_API_VERSION,
      entry,
      name: "demo-plugin",
      options: {
        target: {
          type: "string",
        },
      },
    });
  });

  test("rejects unsupported plugin api versions", async () => {
    const root = await mkdtemp(join(tmpdir(), "rempts-plugin-"));
    const entry = join(root, "index.ts");
    await writeFile(entry, "export {};\n", "utf8");

    expect(() =>
      definePlugin({
        apiVersion: 999 as never,
        entry,
        name: "broken-plugin",
      }),
    ).toThrow(RemptsUsageError);
  });
});
