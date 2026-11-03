import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { c, defineConfig } from "../index";
import {
  DcsConfigWriteConflictError,
  initializeConfigDocument,
  mutateConfigDocument,
  readConfigDocumentForEdit,
} from "./writer";

async function workspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "dcs-writer-"));
}

const noUser = { includeUser: false } as const;

function createBundle() {
  return defineConfig({
    fileStem: "demo-tool",
    id: "org.example.demo-tool",
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
  }).bundle;
}

test("initializes a sparse workspace document and issues a document revision", async () => {
  const root = await workspace();
  try {
    const bundle = createBundle();
    const result = await initializeConfigDocument({
      bundle,
      scope: "workspace",
      schema: "./demo-tool.schema.json",
      workspaceRoot: root,
      ...noUser,
    });

    expect(result.exists).toBe(true);
    expect(result.location).toBe(path.join(root, "demo-tool.config.json"));
    expect(result.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.semanticRevision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.effectiveRevision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.document).toEqual({
      $schema: "./demo-tool.schema.json",
      $dcs: {
        contractVersion: 1,
        documentVersion: 1,
        id: "org.example.demo-tool",
      },
    });

    expect(JSON.parse(await readFile(result.location, "utf8"))).toEqual(result.document);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("preserves extension data, applies structured operations, and detects stale writes", async () => {
  const root = await workspace();
  try {
    const bundle = createBundle();
    const initial = await initializeConfigDocument({
      bundle,
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });

    await writeFile(
      initial.location,
      JSON.stringify(
        {
          $dcs: initial.document.$dcs,
          $extensions: { "org.example.editor": { sidebar: "open" } },
          telemetry: false,
        },
        null,
        2,
      ),
    );
    const snapshot = await readConfigDocumentForEdit({
      bundle,
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });

    const written = await mutateConfigDocument({
      bundle,
      expectedRevision: snapshot.revision,
      patch: { operations: [{ op: "set", path: "/telemetry", value: true }] },
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });

    expect(written.document.$extensions).toEqual({ "org.example.editor": { sidebar: "open" } });
    expect(written.document.telemetry).toBe(true);
    expect(written.effectiveRevision).toMatch(/^sha256:[a-f0-9]{64}$/);

    await expect(
      mutateConfigDocument({
        bundle,
        expectedRevision: snapshot.revision,
        patch: { operations: [{ op: "set", path: "/telemetry", value: false }] },
        scope: "workspace",
        workspaceRoot: root,
        ...noUser,
      }),
    ).rejects.toBeInstanceOf(DcsConfigWriteConflictError);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("reset removes an explicit value and records the reset atomically", async () => {
  const root = await workspace();
  try {
    const bundle = createBundle();
    const initialized = await initializeConfigDocument({
      bundle,
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });

    const set = await mutateConfigDocument({
      bundle,
      expectedRevision: initialized.revision,
      patch: { operations: [{ op: "set", path: "/telemetry", value: true }] },
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });

    const reset = await mutateConfigDocument({
      bundle,
      expectedRevision: set.revision,
      patch: { operations: [{ op: "reset", path: "/telemetry" }] },
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });

    expect(reset.document.telemetry).toBeUndefined();
    expect((reset.document.$dcs as { readonly resets?: readonly string[] }).resets).toEqual([
      "/telemetry",
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("cooperative writers serialize through the lock and one stale revision loses", async () => {
  const root = await workspace();
  try {
    const bundle = createBundle();
    const initialized = await initializeConfigDocument({
      bundle,
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });

    const makeMutation = (value: boolean) =>
      mutateConfigDocument({
        bundle,
        expectedRevision: initialized.revision,
        patch: { operations: [{ op: "set", path: "/telemetry", value }] },
        scope: "workspace",
        workspaceRoot: root,
        ...noUser,
      });

    const outcomes = await Promise.allSettled([makeMutation(true), makeMutation(false)]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(DcsConfigWriteConflictError);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("JSONC writes preserve comments, field order, trailing commas, and report distinct revisions", async () => {
  const root = await workspace();
  try {
    const bundle = createBundle();
    const jsoncPath = path.join(root, "demo-tool.config.jsonc");
    const source = `{
  // do not remove this document comment
  "$dcs": {
    "id": "org.example.demo-tool",
    "contractVersion": 1,
    "documentVersion": 1,
  },
  "editor": {
    // frontend keeps this comment
    "fontSize": 14,
  },
  "telemetry": false, // manual note
}
`;
    await writeFile(jsoncPath, source);

    const before = await readConfigDocumentForEdit({
      bundle,
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    expect(before.format).toBe("jsonc");
    expect(before.location).toBe(jsoncPath);

    const written = await mutateConfigDocument({
      bundle,
      expectedRevision: before.documentRevision,
      patch: { operations: [{ op: "set", path: "/editor/fontSize", value: 16 }] },
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    const text = await readFile(jsoncPath, "utf8");
    expect(text).toContain("// do not remove this document comment");
    expect(text).toContain("// frontend keeps this comment");
    expect(text).toContain("// manual note");
    expect(text).toContain('"fontSize": 16,');
    expect(text).toContain('"telemetry": false,');
    expect(written.format).toBe("jsonc");
    expect(written.documentRevision).not.toBe(before.documentRevision);
    expect(written.semanticRevision).not.toBe(before.semanticRevision);
    expect(written.effectiveRevision).toMatch(/^sha256:[a-f0-9]{64}$/);

    const commentOnly = text.replace("// manual note", "// manual note changed by a human");
    await writeFile(jsoncPath, commentOnly);
    const afterComment = await readConfigDocumentForEdit({
      bundle,
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    expect(afterComment.documentRevision).not.toBe(written.documentRevision);
    expect(afterComment.semanticRevision).toBe(written.semanticRevision);

    await expect(
      mutateConfigDocument({
        bundle,
        expectedRevision: written.documentRevision,
        patch: { operations: [{ op: "set", path: "/telemetry", value: true }] },
        scope: "workspace",
        workspaceRoot: root,
        ...noUser,
      }),
    ).rejects.toBeInstanceOf(DcsConfigWriteConflictError);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("JSONC initialization can be explicitly selected and duplicate JSON/JSONC is rejected", async () => {
  const root = await workspace();
  try {
    const bundle = createBundle();
    const initialized = await initializeConfigDocument({
      bundle,
      format: "jsonc",
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    expect(initialized.location).toBe(path.join(root, "demo-tool.config.jsonc"));
    expect(initialized.format).toBe("jsonc");
    await writeFile(path.join(root, "demo-tool.config.json"), JSON.stringify(initialized.document));

    await expect(
      readConfigDocumentForEdit({
        bundle,
        scope: "workspace",
        workspaceRoot: root,
        ...noUser,
      }),
    ).rejects.toThrow("Both JSON and JSONC DCS documents exist");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("JSONC positional move rewrites only the touched array field", async () => {
  const root = await workspace();
  try {
    const bundle = createBundle();
    const jsoncPath = path.join(root, "demo-tool.config.jsonc");
    await writeFile(
      jsoncPath,
      `{
  // keep this comment outside the changed array
  "$dcs": {
    "id": "org.example.demo-tool",
    "contractVersion": 1,
    "documentVersion": 1,
  },
  "plugins": ["audit", "deploy", "shell"],
  "telemetry": false,
}
`,
    );

    const before = await readConfigDocumentForEdit({
      bundle,
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    const written = await mutateConfigDocument({
      bundle,
      expectedRevision: before.documentRevision,
      patch: { operations: [{ from: 1, op: "move", path: "/plugins", to: 0 }] },
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });

    expect(written.document.plugins).toEqual(["deploy", "audit", "shell"]);
    const text = await readFile(jsoncPath, "utf8");
    expect(text).toContain("// keep this comment outside the changed array");
    expect(text).toContain('"telemetry": false,');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("profile writes target a separate document and keep the matching profile envelope", async () => {
  const root = await workspace();
  try {
    const bundle = createBundle();
    const base = await initializeConfigDocument({
      bundle,
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    const profile = await initializeConfigDocument({
      bundle,
      format: "jsonc",
      profile: "production",
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });

    expect(base.location).toBe(path.join(root, "demo-tool.config.json"));
    expect(profile.location).toBe(path.join(root, "demo-tool.config.production.jsonc"));
    expect(profile.profile).toBe("production");
    expect(profile.document.$dcs).toEqual({
      contractVersion: 1,
      documentVersion: 1,
      id: "org.example.demo-tool",
      profile: "production",
    });

    const written = await mutateConfigDocument({
      bundle,
      expectedRevision: profile.documentRevision,
      format: "jsonc",
      patch: { operations: [{ op: "set", path: "/telemetry", value: true }] },
      profile: "production",
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    expect(written.profile).toBe("production");
    expect(written.document.telemetry).toBe(true);
    expect(await readFile(profile.location, "utf8")).toContain('"profile": "production"');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("JSONC identity collection edits preserve comments while writing sparse remove and move directives", async () => {
  const root = await workspace();
  try {
    const bundle = defineConfig({
      fileStem: "collection-writer",
      id: "org.example.collection-writer",
      root: c.object({
        plugins: c
          .array(c.object({ id: c.string().default(""), enabled: c.boolean().default(true) }))
          .default([
            { enabled: true, id: "rse.audit" },
            { enabled: true, id: "rse.deploy" },
            { enabled: true, id: "rse.extra" },
          ])
          .merge("keyed")
          .collection({ identity: "/id" }),
      }),
    }).bundle;
    const initial = await initializeConfigDocument({
      bundle,
      format: "jsonc",
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    await writeFile(
      initial.location,
      `{
  // keep this user note
  "$dcs": {
    "id": "org.example.collection-writer"
  }
}
`,
    );
    const snapshot = await readConfigDocumentForEdit({
      bundle,
      format: "jsonc",
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    const written = await mutateConfigDocument({
      bundle,
      expectedRevision: snapshot.documentRevision,
      format: "jsonc",
      patch: {
        operations: [
          { id: "rse.audit", op: "remove", path: "/plugins" },
          { before: "rse.extra", id: "rse.deploy", op: "move-by-id", path: "/plugins" },
        ],
      },
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    const text = await readFile(written.location, "utf8");
    expect(text).toContain("// keep this user note");
    expect(written.document.$dcs).toMatchObject({
      collectionMoves: { "/plugins": [{ before: "rse.extra", id: "rse.deploy" }] },
      collectionRemovals: { "/plugins": ["rse.audit"] },
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
