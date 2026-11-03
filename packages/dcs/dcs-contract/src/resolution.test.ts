import { expect, test } from "bun:test";

import {
  createConfigContractBundle,
  explainConfigPath,
  parseConfigDocument,
  resolveConfigLayers,
  type ConfigContractBundle,
  type DcsScope,
  type JsonObject,
} from "./index";

const bundle = createConfigContractBundle({
  $dcs: {
    contractVersion: 1,
    documentVersion: 1,
    fileStem: "resolution-demo",
    id: "org.reliverse.resolution-demo",
    specVersion: "0.0.1",
  },
  defaults: {
    editor: { fontSize: 14, theme: "dark" },
    plugins: [],
    telemetry: false,
  },
  fields: {
    "/editor": {
      merge: "deep",
      resettable: true,
      scopes: ["user", "workspace", "local", "invocation"],
    },
    "/editor/fontSize": {
      merge: "replace",
      resettable: true,
      scopes: ["user", "workspace", "local", "invocation"],
    },
    "/editor/theme": {
      merge: "replace",
      resettable: true,
      scopes: ["user", "workspace", "local", "invocation"],
    },
    "/plugins": {
      merge: "replace",
      resettable: true,
      scopes: ["user", "workspace", "local", "invocation"],
    },
    "/telemetry": {
      merge: "replace",
      resettable: true,
      scopes: ["user", "workspace", "invocation"],
    },
  },
  schema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    properties: {
      editor: {
        additionalProperties: false,
        properties: {
          fontSize: { type: "number" },
          theme: { enum: ["dark", "light"] },
        },
        required: ["fontSize", "theme"],
        type: "object",
      },
      plugins: {
        items: { type: "string" },
        type: "array",
      },
      telemetry: { type: "boolean" },
    },
    required: ["editor", "plugins", "telemetry"],
    type: "object",
  },
});

function document(value: Record<string, unknown>, scope: DcsScope) {
  const parsed = parseConfigDocument(JSON.stringify(value), { bundle, scope });
  if (parsed.document === undefined) {
    throw new Error(parsed.diagnostics.map((entry) => entry.message).join("\n"));
  }
  return parsed.document;
}

test("resolver applies fixed precedence, deep fields, replace arrays, resets, and provenance", () => {
  const result = resolveConfigLayers({
    bundle,
    layers: [
      {
        document: document({ editor: { theme: "light" }, plugins: ["user"] }, "user"),
        scope: "user",
        source: {
          kind: "user-document",
          location: "/home/demo/.config/resolution-demo/config.json",
        },
      },
      {
        document: document(
          { editor: { fontSize: 16 }, plugins: ["workspace"], telemetry: true },
          "workspace",
        ),
        scope: "workspace",
        source: { kind: "workspace-document", location: "/repo/resolution-demo.config.json" },
      },
      {
        document: document({ $dcs: { resets: ["/editor/fontSize"] }, plugins: ["local"] }, "local"),
        scope: "local",
        source: { kind: "local-document", location: "/repo/.resolution-demo/config.local.json" },
      },
      {
        document: document({ telemetry: false }, "invocation"),
        scope: "invocation",
        source: { kind: "invocation-override" },
      },
    ],
  });

  expect(result.ok).toBe(true);
  expect(result.resolved?.value).toEqual({
    editor: { fontSize: 14, theme: "light" },
    plugins: ["local"],
    telemetry: false,
  });

  const fontSize = explainConfigPath(result.resolved!, "/editor/fontSize");
  expect(fontSize?.effectiveSource).toEqual({ kind: "defaults" });
  expect(fontSize?.resets).toEqual([
    { kind: "local-document", location: "/repo/.resolution-demo/config.local.json" },
  ]);
  expect(
    fontSize?.consideredSources.find((entry) => entry.source.kind === "local-document")?.used,
  ).toBe(true);

  expect(explainConfigPath(result.resolved!, "/editor/theme")?.effectiveSource).toEqual({
    kind: "user-document",
    location: "/home/demo/.config/resolution-demo/config.json",
  });
  expect(explainConfigPath(result.resolved!, "/editor")?.effectiveSource).toEqual({
    kind: "mixed",
  });
  expect(explainConfigPath(result.resolved!, "/plugins")?.effectiveSource).toEqual({
    kind: "local-document",
    location: "/repo/.resolution-demo/config.local.json",
  });
});

test("a deep object reports one effective source when all child fields come from one layer", () => {
  const result = resolveConfigLayers({
    bundle,
    layers: [
      {
        document: document({ editor: { fontSize: 18, theme: "light" } }, "workspace"),
        scope: "workspace",
        source: { kind: "workspace-document", location: "/repo/resolution-demo.config.json" },
      },
    ],
  });

  expect(explainConfigPath(result.resolved!, "/editor")?.effectiveSource).toEqual({
    kind: "workspace-document",
    location: "/repo/resolution-demo.config.json",
  });
});

test("resolver rejects duplicate scope selections instead of guessing", () => {
  const user = document({ plugins: ["one"] }, "user");
  const result = resolveConfigLayers({
    bundle,
    layers: [
      { document: user, scope: "user", source: { kind: "user-document", location: "/a.json" } },
      { document: user, scope: "user", source: { kind: "user-document", location: "/b.json" } },
    ],
  });

  expect(result.ok).toBe(false);
  expect(result.diagnostics.map((entry) => entry.code)).toContain("DCS3008");
});

test("resolver never exports resolved secret material through provenance", () => {
  const secretBundle = createConfigContractBundle({
    ...bundle,
    $dcs: {
      ...bundle.$dcs,
      fileStem: "secret-resolution-demo",
      id: "org.reliverse.secret-resolution-demo",
    },
    defaults: {
      ...bundle.defaults,
      token: { $secret: { key: "demo-token", provider: "keychain" } },
    },
    fields: {
      ...bundle.fields,
      "/token": {
        merge: "replace",
        resettable: true,
        scopes: ["user", "workspace", "local", "invocation"],
        secret: true,
      },
    },
    schema: {
      ...bundle.schema,
      properties: {
        ...(bundle.schema.properties as JsonObject),
        token: {
          additionalProperties: false,
          properties: {
            $secret: {
              additionalProperties: false,
              properties: {
                key: { type: "string" },
                provider: { type: "string" },
              },
              required: ["provider", "key"],
              type: "object",
            },
          },
          required: ["$secret"],
          type: "object",
        },
      },
    },
  } as ConfigContractBundle);

  const parsed = parseConfigDocument(
    { token: { $secret: { key: "other-token", provider: "keychain" } } },
    { bundle: secretBundle, scope: "user" },
  );
  const result = resolveConfigLayers({
    bundle: secretBundle,
    layers: [
      {
        document: parsed.document!,
        scope: "user",
        source: { kind: "user-document", location: "/user.json" },
      },
    ],
  });

  expect(explainConfigPath(result.resolved!, "/token")).toEqual(
    expect.objectContaining({
      redacted: true,
    }),
  );
  expect(JSON.stringify(explainConfigPath(result.resolved!, "/token"))).not.toContain(
    "other-token",
  );
});

test("explicit profile overlays resolve after their base scope and provenance records the profile source", () => {
  const userBase = document({ editor: { theme: "light" } }, "user");
  const userProfileParsed = parseConfigDocument(
    { $dcs: { profile: "production" }, editor: { fontSize: 18 }, plugins: ["profile"] },
    { bundle, profile: "production", scope: "user" },
  );
  expect(userProfileParsed.ok).toBe(true);

  const workspaceBase = document({ plugins: ["workspace"], telemetry: true }, "workspace");
  const workspaceProfileParsed = parseConfigDocument(
    { $dcs: { profile: "production" }, telemetry: false },
    { bundle, profile: "production", scope: "workspace" },
  );
  expect(workspaceProfileParsed.ok).toBe(true);

  const result = resolveConfigLayers({
    bundle,
    layers: [
      {
        document: userBase,
        scope: "user",
        source: { kind: "user-document", location: "/user/config.json" },
      },
      {
        document: userProfileParsed.document!,
        profile: "production",
        scope: "user",
        source: {
          kind: "user-profile-document",
          location: "/user/config.production.json",
          profile: "production",
        },
      },
      {
        document: workspaceBase,
        scope: "workspace",
        source: { kind: "workspace-document", location: "/repo/config.json" },
      },
      {
        document: workspaceProfileParsed.document!,
        profile: "production",
        scope: "workspace",
        source: {
          kind: "workspace-profile-document",
          location: "/repo/config.production.json",
          profile: "production",
        },
      },
    ],
  });

  expect(result.ok).toBe(true);
  expect(result.resolved?.value).toEqual({
    editor: { fontSize: 18, theme: "light" },
    plugins: ["workspace"],
    telemetry: false,
  });
  expect(explainConfigPath(result.resolved!, "/editor/fontSize")?.effectiveSource).toEqual({
    kind: "user-profile-document",
    location: "/user/config.production.json",
    profile: "production",
  });
  expect(explainConfigPath(result.resolved!, "/telemetry")?.effectiveSource).toEqual({
    kind: "workspace-profile-document",
    location: "/repo/config.production.json",
    profile: "production",
  });
});

test("profile documents are rejected unless an explicit matching profile is selected", () => {
  const base = parseConfigDocument(
    { $dcs: { profile: "production" }, telemetry: true },
    { bundle, scope: "workspace" },
  );
  expect(base.ok).toBe(false);
  expect(base.diagnostics.map((entry) => entry.code)).toContain("DCS2025");

  const mismatch = parseConfigDocument(
    { $dcs: { profile: "staging" }, telemetry: true },
    { bundle, profile: "production", scope: "workspace" },
  );
  expect(mismatch.ok).toBe(false);
  expect(mismatch.diagnostics.map((entry) => entry.code)).toContain("DCS2026");
});
