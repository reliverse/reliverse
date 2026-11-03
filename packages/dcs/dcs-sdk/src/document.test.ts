import { expect, test } from "bun:test";

import { c, defineConfig, parseConfigDocument } from "./index";

const config = defineConfig({
  fileStem: "demo-tool",
  id: "org.reliverse.demo-tool",
  root: c.object({
    editor: c
      .object({
        fontSize: c.number().default(14),
        theme: c.enum(["dark", "light"] as const).default("dark"),
      })
      .merge("deep"),
    telemetry: c.boolean().default(false).scopes(["user"]),
    token: c.secretReference(),
  }),
});

test("parseConfigDocument accepts sparse deep workspace config and preserves extensions", () => {
  const result = parseConfigDocument(
    {
      $schema: "./schema/demo-tool.json",
      $dcs: { id: "org.reliverse.demo-tool", resets: ["/editor/fontSize"] },
      $extensions: { "org.reliverse.rse": { mode: "assist" } },
      editor: { theme: "light" },
    },
    { bundle: config.bundle, scope: "workspace" },
  );

  expect(result.ok).toBe(true);
  expect(result.document?.product).toEqual({ editor: { theme: "light" } });
  expect(result.document?.schema).toBe("./schema/demo-tool.json");
  expect(result.document?.extensions).toEqual({
    "org.reliverse.rse": { mode: "assist" },
  });
});

test("parseConfigDocument rejects an invalid editor schema reference", () => {
  const result = parseConfigDocument(
    { $schema: "", editor: { theme: "light" } },
    { bundle: config.bundle, scope: "workspace" },
  );

  expect(result.ok).toBe(false);
  expect(result.diagnostics.some((diagnostic) => diagnostic.code === "DCS2012")).toBe(true);
});

test("parseConfigDocument rejects a disallowed scope and raw secret material", () => {
  const result = parseConfigDocument(
    JSON.stringify({
      telemetry: true,
      token: "not-a-reference",
    }),
    { bundle: config.bundle, scope: "workspace" },
  );

  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["DCS2014", "DCS2015"]);
});

test("parseConfigDocument rejects a reset that also has a value", () => {
  const result = parseConfigDocument(
    {
      $dcs: { resets: ["/editor/fontSize"] },
      editor: { fontSize: 16 },
    },
    { bundle: config.bundle, scope: "user" },
  );

  expect(result.ok).toBe(false);
  expect(result.diagnostics.some((diagnostic) => diagnostic.code === "DCS3005")).toBe(true);
});
