import { expect, test } from "bun:test";

import { c, defineConfig } from "./index";

test("defineConfig generates a deterministic bundle from one Config IR", async () => {
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
      plugins: c.array(c.string()).default([]),
      telemetry: c.boolean().default(false).scopes(["user", "workspace"]),
      token: c.secretReference(),
    }),
  });

  expect(config.bundle.$dcs).toEqual({
    contractVersion: 1,
    documentVersion: 1,
    fileStem: "demo-tool",
    id: "org.reliverse.demo-tool",
    specVersion: "0.0.1",
  });
  expect(config.bundle.defaults).toEqual({
    editor: { fontSize: 14, theme: "dark" },
    plugins: [],
    telemetry: false,
  });
  expect(config.bundle.fields["/editor"]?.merge).toBe("deep");
  expect(config.bundle.fields["/editor/theme"]?.scopes).toEqual([
    "user",
    "workspace",
    "local",
    "invocation",
  ]);
  expect(config.bundle.fields["/token"]?.secret).toBe(true);
  expect(config.toJson()).toContain('"$dcs"');
  expect(await config.digest()).toHaveLength(64);
});

test("defineConfig output matches the committed portable CCB fixture", async () => {
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
      plugins: c.array(c.string()).default([]),
      telemetry: c.boolean().default(false).scopes(["user", "workspace"]),
      token: c.secretReference(),
    }),
  });

  const expected = await Bun.file(
    new URL(
      "../../dcs-conformance/fixtures/001-bundle-generation/expected.config-contract.json",
      import.meta.url,
    ),
  ).text();

  expect(JSON.parse(config.toJson())).toEqual(JSON.parse(expected));
});

test("defineConfig rejects deep merge outside object fields", () => {
  expect(() =>
    defineConfig({
      fileStem: "invalid",
      id: "org.reliverse.invalid",
      root: c.object({
        enabled: c.boolean().default(true).merge("deep"),
      }),
    }),
  ).toThrow("Only object fields may use deep merge");
});

test("defineConfig rejects required fields without defaults", () => {
  expect(() =>
    defineConfig({
      fileStem: "missing-default",
      id: "org.reliverse.missing-default",
      root: c.object({
        enabled: c.boolean(),
      }),
    }),
  ).toThrow("must declare a default");
});

test("defineConfig carries declarative migration routes into the target CCB and IR artifact", () => {
  const definition = defineConfig({
    contractVersion: 2,
    documentVersion: 1,
    fileStem: "demo-tool",
    id: "org.example.demo-tool",
    migrations: [
      {
        $dcs: {
          format: "dcs-migration-plan",
          from: { contractVersion: 1, documentVersion: 1 },
          id: "org.example.demo-tool",
          to: { contractVersion: 2, documentVersion: 1 },
          version: "0.0.1",
        },
        operations: [{ from: "/server", op: "rename", to: "/network" }],
      },
    ],
    root: c.object({
      network: c
        .object({ host: c.string().default("0.0.0.0") })
        .default({ host: "0.0.0.0" })
        .merge("deep"),
    }),
  });

  expect(definition.bundle.migrations?.[0]?.operations).toEqual([
    { from: "/server", op: "rename", to: "/network" },
  ]);
  expect(definition.ir.migrations?.[0]?.$dcs.from.contractVersion).toBe(1);
  expect(definition.toIrArtifact().ir.migrations?.[0]?.$dcs.to.contractVersion).toBe(2);
});

test("defineConfig carries extension requirements into IR and the portable CCB", () => {
  const definition = defineConfig({
    extensionRequirements: [{ id: "org.reliverse.rse", minVersion: 2, required: true }],
    fileStem: "demo-tool",
    id: "org.example.demo-tool",
    root: c.object({
      telemetry: c.boolean().default(false),
    }),
  });

  expect(definition.ir.extensionRequirements).toEqual([
    { id: "org.reliverse.rse", minVersion: 2, required: true },
  ]);
  expect(definition.bundle.extensionRequirements).toEqual(definition.ir.extensionRequirements);
  expect(definition.toIrArtifact().ir.extensionRequirements).toEqual(
    definition.ir.extensionRequirements,
  );
});
