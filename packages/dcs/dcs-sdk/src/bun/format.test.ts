import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import {
  createConfigContractBundle,
  JSON_SCHEMA_2020_12_DIALECT,
  type ConfigContractBundle,
} from "@reliverse/dcs-contract";

import {
  bindDcsBunForeignDocument,
  convertDcsBunForeignDocument,
  inspectDcsBunForeignDocument,
  parseDcsBunForeignDocument,
} from "./index";

const bundle = createConfigContractBundle({
  $dcs: {
    contractVersion: 1,
    documentVersion: 1,
    fileStem: "foreign-demo",
    id: "org.reliverse.foreign-demo",
    specVersion: "0.0.1",
  },
  defaults: { telemetry: false },
  fields: {
    "/telemetry": { merge: "replace", scopes: ["user", "workspace", "local"] },
  },
  schema: {
    $schema: JSON_SCHEMA_2020_12_DIALECT,
    additionalProperties: false,
    properties: { telemetry: { type: "boolean" } },
    type: "object",
  },
} satisfies ConfigContractBundle);

test("Bun-native foreign parsers cover JSONC, JSON5, YAML, TOML, and text", () => {
  expect(
    parseDcsBunForeignDocument({ format: "jsonc", source: '// hi\n{"telemetry": true,}' }).value,
  ).toEqual({ telemetry: true });
  expect(
    parseDcsBunForeignDocument({ format: "json5", source: "{telemetry: true,}" }).value,
  ).toEqual({ telemetry: true });
  expect(parseDcsBunForeignDocument({ format: "yaml", source: "telemetry: true\n" }).value).toEqual(
    { telemetry: true },
  );
  expect(
    parseDcsBunForeignDocument({ format: "toml", source: "telemetry = true\n" }).value,
  ).toEqual({ telemetry: true });
  expect(parseDcsBunForeignDocument({ format: "text", source: "raw config" }).value).toBe(
    "raw config",
  );
});

test("foreign document inspection reports write support without claiming lossless YAML/TOML writes", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "dcs-bun-formats-"));
  try {
    const yaml = path.join(workspace, "demo.yaml");
    await writeFile(yaml, "telemetry: true\n");
    const inspect = await inspectDcsBunForeignDocument({ location: yaml });
    expect(inspect.ok).toBe(true);
    expect(inspect.format).toBe("yaml");
    expect(inspect.writeSupport).toBe("none");
    expect(inspect.valueKind).toBe("object");
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test("foreign binding validates JSON-compatible object values against a DCS CCB", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "dcs-bun-bind-"));
  try {
    const valid = path.join(workspace, "demo.toml");
    const invalid = path.join(workspace, "demo.invalid.yaml");
    await writeFile(valid, "telemetry = true\n");
    await writeFile(invalid, "telemetry: maybe\n");

    const ok = await bindDcsBunForeignDocument({ bundle, location: valid, scope: "workspace" });
    expect(ok.bound).toBe(true);
    expect(ok.bindingDiagnostics).toEqual([]);

    const fail = await bindDcsBunForeignDocument({ bundle, location: invalid, scope: "workspace" });
    expect(fail.bound).toBe(false);
    expect(fail.bindingDiagnostics.some((entry) => entry.code === "DCS2017")).toBe(true);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test("foreign conversion emits canonical JSON or comment-free JSONC only", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "dcs-bun-convert-"));
  try {
    const json5 = path.join(workspace, "demo.json5");
    await writeFile(json5, "{telemetry: true,}\n");
    const json = await convertDcsBunForeignDocument({ location: json5, target: "json" });
    expect(json.text).toBe('{"telemetry":true}\n');
    const jsonc = await convertDcsBunForeignDocument({ location: json5, target: "jsonc" });
    expect(jsonc.text).toContain('"telemetry": true');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});
