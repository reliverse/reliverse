import { expect, test } from "bun:test";

import {
  applyDcsDocumentPatch,
  applyDcsEditorSessionPatch,
  c,
  createDcsEditorInvalidationEvent,
  createDcsEditorSession,
  createDcsEditorSessionView,
  defineConfig,
  rebaseDcsDocumentPatch,
} from "./index";

const config = defineConfig({
  fileStem: "editor-demo",
  id: "org.example.editor-demo",
  root: c.object({
    editor: c.object({ theme: c.enum(["dark", "light"] as const).default("dark") }).merge("deep"),
    plugins: c.array(c.string()).default(["rse.audit", "rse.deploy"]),
    telemetry: c.boolean().default(false),
    token: c.secretReference(),
  }),
});

function baseDocument() {
  return {
    $dcs: { contractVersion: 1, documentVersion: 1, id: "org.example.editor-demo" },
    editor: { theme: "dark" },
    plugins: ["rse.audit", "rse.deploy"],
    telemetry: false,
    token: { $secret: { key: "api-token", provider: "keychain" } },
  } as const;
}

test("non-overlapping changes rebase onto the latest document", () => {
  const base = baseDocument();
  const latest = applyDcsDocumentPatch(base, {
    operations: [{ op: "set", path: "/editor/theme", value: "light" }],
  });
  const result = rebaseDcsDocumentPatch({
    baseDocument: base,
    bundle: config.bundle,
    latestDocument: latest,
    patch: { operations: [{ op: "set", path: "/telemetry", value: true }] },
  });

  expect(result.kind).toBe("rebased");
  if (result.kind === "rebased") {
    expect(result.changedPaths).toEqual(["/editor/theme"]);
    expect(result.document).toMatchObject({ editor: { theme: "light" }, telemetry: true });
  }
});

test("same-path rebase returns a structured conflict and redacts secret references", () => {
  const base = baseDocument();
  const latest = applyDcsDocumentPatch(base, {
    operations: [
      { op: "set", path: "/token", value: { $secret: { key: "other", provider: "keychain" } } },
    ],
  });
  const result = rebaseDcsDocumentPatch({
    baseDocument: base,
    bundle: config.bundle,
    latestDocument: latest,
    patch: {
      operations: [
        { op: "set", path: "/token", value: { $secret: { key: "mine", provider: "keychain" } } },
      ],
    },
  });

  expect(result.kind).toBe("conflict");
  if (result.kind === "conflict") {
    expect(result.changedPaths).toEqual(["/token/$secret/key"]);
    expect(result.conflicts[0]).toMatchObject({
      base: { state: "redacted" },
      latest: { state: "redacted" },
      proposed: { state: "redacted" },
      reason: "overlapping-change",
    });
  }
});

test("session views omit raw documents, track selected scope, and mark local edits stale", () => {
  const session = createDcsEditorSession({
    bundle: config.bundle,
    document: {
      document: baseDocument(),
      documentRevision: "sha256:base",
      semanticRevision: "sha256:semantic",
    },
    scope: "workspace",
  });
  const changed = applyDcsEditorSessionPatch(session, {
    operations: [{ op: "set", path: "/telemetry", value: true }],
  });
  const view = createDcsEditorSessionView(changed) as unknown as Record<string, unknown>;

  expect(changed.scope).toBe("workspace");
  expect(changed.resolutionState).toBe("stale");
  expect(changed.patch.operations).toHaveLength(1);
  expect(view.document).toBeUndefined();
  expect(view.base).toBeUndefined();
  expect(
    view.patch as {
      readonly operationCount: number;
      readonly operations?: unknown;
      readonly touchedPaths: readonly string[];
    },
  ).toEqual({
    operationCount: 1,
    touchedPaths: ["/telemetry"],
  });
  expect(
    (
      view.model as {
        readonly fields: readonly { readonly path: string; readonly documentValue: unknown }[];
      }
    ).fields.find((field) => field.path === "/telemetry")?.documentValue,
  ).toEqual({ state: "value", value: true });
});

test("positional array move is local, explicit, and conflicts on the whole array path", () => {
  const moved = applyDcsDocumentPatch(baseDocument(), {
    operations: [{ from: 1, op: "move", path: "/plugins", to: 0 }],
  });
  expect(moved.plugins).toEqual(["rse.deploy", "rse.audit"]);

  const latest = applyDcsDocumentPatch(baseDocument(), {
    operations: [{ op: "set", path: "/plugins", value: ["rse.audit", "rse.deploy", "rse.extra"] }],
  });
  const result = rebaseDcsDocumentPatch({
    baseDocument: baseDocument(),
    bundle: config.bundle,
    latestDocument: latest,
    patch: { operations: [{ from: 1, op: "move", path: "/plugins", to: 0 }] },
  });
  expect(result.kind).toBe("conflict");
});

test("invalidation events remain transport-neutral", () => {
  const event = createDcsEditorInvalidationEvent({
    cause: "document-changed",
    documentRevision: "sha256:next",
    scope: "workspace",
  });
  expect(event).toEqual({
    $dcs: { format: "dcs-editor-invalidation", version: "0.0.1" },
    cause: "document-changed",
    documentRevision: "sha256:next",
    scope: "workspace",
  });
});

test("identity collection edits return collection-aware conflicts instead of guessing a reorder winner", () => {
  const collectionConfig = defineConfig({
    fileStem: "collection-session",
    id: "org.example.collection-session",
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
    $dcs: { contractVersion: 1, documentVersion: 1, id: "org.example.collection-session" },
    plugins: [
      { enabled: true, id: "rse.audit" },
      { enabled: true, id: "rse.deploy" },
    ],
  } as const;
  const latest = applyDcsDocumentPatch(base, {
    operations: [
      {
        op: "set",
        path: "/plugins",
        value: [
          { enabled: true, id: "rse.deploy" },
          { enabled: true, id: "rse.audit" },
        ],
      },
    ],
  });
  const result = rebaseDcsDocumentPatch({
    baseDocument: base,
    bundle: collectionConfig.bundle,
    latestDocument: latest,
    patch: { operations: [{ id: "rse.audit", op: "remove", path: "/plugins" }] },
  });
  expect(result.kind).toBe("conflict");
  if (result.kind === "conflict") {
    expect(result.conflicts[0]).toMatchObject({
      collection: { baseIds: ["rse.audit", "rse.deploy"], latestIds: ["rse.deploy", "rse.audit"] },
      reason: "collection-overlap",
    });
  }
});
