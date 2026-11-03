import { expect, test } from "bun:test";

import {
  applyDcsDocumentPatch,
  createDcsConfigDocument,
  createDcsConfigDocumentSchema,
} from "./editor";
import { c, defineConfig } from "./index";

const bundle = defineConfig({
  fileStem: "demo-tool",
  id: "org.reliverse.demo-tool",
  root: c.object({
    editor: c
      .object({
        fontSize: c.number().default(14),
        theme: c.enum(["dark", "light"] as const).default("dark"),
      })
      .merge("deep"),
  }),
}).bundle;

test("config document schemas allow sparse product objects", () => {
  const schema = createDcsConfigDocumentSchema(bundle);
  expect(schema.required).toBeUndefined();
  expect(
    ((schema.properties as Record<string, unknown>).editor as Record<string, unknown>).required,
  ).toBeUndefined();
});

test("structured document operations clear overlapping resets before setting a path", () => {
  const seeded = {
    ...createDcsConfigDocument(bundle),
    $dcs: { resets: ["/editor"] },
  };

  const result = applyDcsDocumentPatch(seeded, {
    operations: [{ op: "set", path: "/editor/fontSize", value: 16 }],
  });

  expect(result).toEqual({
    $dcs: {},
    editor: { fontSize: 16 },
  });
});

test("reset removes an explicit value and forms a sparse reset declaration", () => {
  const result = applyDcsDocumentPatch(
    { editor: { theme: "light" } },
    {
      operations: [{ op: "reset", path: "/editor/theme" }],
    },
  );

  expect(result).toEqual({
    $dcs: { resets: ["/editor/theme"] },
    editor: {},
  });
});

import {
  createDcsExtensionRegistry,
  parseConfigDocument,
  resolveConfigLayers,
} from "@reliverse/dcs-contract";

import { createDcsEditorModel } from "./editor";

test("headless editor model exposes selected-layer state, presentation, provenance, and redaction", () => {
  const editorConfig = defineConfig({
    fileStem: "editor-demo",
    id: "org.example.editor-demo",
    root: c.object({
      editor: c
        .object({
          fontSize: c.number().default(14).presentation({
            control: "number",
            group: "Editor",
            label: "Font size",
            order: 20,
          }),
          theme: c
            .enum(["dark", "light"] as const)
            .default("dark")
            .presentation({
              control: "select",
              group: "Editor",
              label: "Theme",
              order: 10,
            }),
        })
        .merge("deep"),
      enabled: c.boolean().default(true).scopes(["user"]),
      token: c.secretReference(),
    }),
  });
  const document = {
    $dcs: { resets: ["/editor/theme"] },
    editor: { fontSize: 18 },
    token: { $secret: { key: "api-token", provider: "keychain" } },
  };
  const parsed = parseConfigDocument(document, { bundle: editorConfig.bundle, scope: "workspace" });
  expect(parsed.ok).toBe(true);
  const resolved = resolveConfigLayers({
    bundle: editorConfig.bundle,
    layers: [
      {
        document: parsed.document!,
        scope: "workspace",
        source: { kind: "workspace-document", location: "memory" },
      },
    ],
  });
  expect(resolved.ok).toBe(true);

  if (resolved.resolved === undefined) throw new Error("Expected resolved config.");
  const model = createDcsEditorModel({
    bundle: editorConfig.bundle,
    document: { document, revision: "sha256:test" },
    resolved: resolved.resolved,
    scope: "workspace",
  });
  const fontSize = model.fields.find((field) => field.path === "/editor/fontSize");
  const theme = model.fields.find((field) => field.path === "/editor/theme");
  const enabled = model.fields.find((field) => field.path === "/enabled");
  const token = model.fields.find((field) => field.path === "/token");

  expect(fontSize).toMatchObject({
    control: "number",
    editable: true,
    group: "Editor",
    label: "Font size",
    state: "overridden",
  });
  expect(fontSize?.documentValue).toEqual({ state: "value", value: 18 });
  expect(theme?.state).toBe("reset");
  expect(enabled?.editable).toBe(false);
  expect(token?.documentValue).toEqual({ state: "redacted" });
  expect(token?.effectiveValue).toEqual({ state: "redacted" });
  expect(model.groups.find((group) => group.id === "Editor")?.fields).toContain("/editor/fontSize");
});

test("headless editor model surfaces local known extension metadata and redacts nested secret references", () => {
  const registry = createDcsExtensionRegistry([
    {
      $dcs: {
        compatibleDcsSpecVersions: ["0.0.1"],
        extensionVersion: 1,
        format: "dcs-extension-contract",
        id: "org.example.agent",
        version: "0.0.1",
      },
      presentation: { group: "Agents", label: "Agent" },
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: true,
        properties: {},
        type: "object",
      },
    },
  ]);
  const extensionDocument = {
    $extensions: {
      "org.example.agent": {
        token: { $secret: { key: "agent-token", provider: "keychain" } },
      },
      "org.example.unknown": { enabled: true },
    },
  };

  const model = createDcsEditorModel({
    bundle,
    document: { document: extensionDocument, documentRevision: "sha256:extension" },
    extensionRegistry: registry,
    scope: "workspace",
  });
  const known = model.extensions.find((extension) => extension.id === "org.example.agent");
  const unknown = model.extensions.find((extension) => extension.id === "org.example.unknown");

  expect(known).toMatchObject({ editable: true, known: true, presentation: { label: "Agent" } });
  expect(known?.value).toEqual({ state: "value", value: { token: "<redacted>" } });
  expect(unknown).toMatchObject({ editable: false, known: false });
});

test("identity collection remove and move directives stay sparse in the document envelope", () => {
  const collectionConfig = defineConfig({
    fileStem: "collection-editor",
    id: "org.example.collection-editor",
    root: c.object({
      plugins: c
        .array(c.object({ id: c.string().default(""), enabled: c.boolean().default(true) }))
        .default([
          { enabled: true, id: "rse.audit" },
          { enabled: true, id: "rse.deploy" },
        ])
        .merge("keyed")
        .collection({ identity: "/id" }),
    }),
  });
  const base = {
    $dcs: { contractVersion: 1, documentVersion: 1, id: "org.example.collection-editor" },
  } as const;
  const moved = applyDcsDocumentPatch(base, {
    operations: [
      { id: "rse.audit", op: "remove", path: "/plugins" },
      { before: "rse.audit", id: "rse.deploy", op: "move-by-id", path: "/plugins" },
    ],
  });
  expect((moved.$dcs as { readonly collectionRemovals?: unknown }).collectionRemovals).toEqual({
    "/plugins": ["rse.audit"],
  });
  expect((moved.$dcs as { readonly collectionMoves?: unknown }).collectionMoves).toEqual({
    "/plugins": [{ before: "rse.audit", id: "rse.deploy" }],
  });
  expect(collectionConfig.bundle.fields["/plugins"]?.collection).toEqual({ identity: "/id" });
});
