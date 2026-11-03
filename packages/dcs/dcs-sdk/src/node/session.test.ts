import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { applyDcsEditorSessionPatch, c, defineConfig } from "../index";
import {
  commitDcsEditorSession,
  initializeConfigDocument,
  mutateConfigDocument,
  openDcsEditorSession,
  readConfigDocumentForEdit,
} from "./index";

const noUser = { includeUser: false } as const;

function createBundle() {
  return defineConfig({
    fileStem: "session-demo",
    id: "org.example.session-demo",
    root: c.object({
      editor: c.object({ theme: c.enum(["dark", "light"] as const).default("dark") }).merge("deep"),
      telemetry: c.boolean().default(false),
    }),
  }).bundle;
}

async function workspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "dcs-session-"));
}

test("server commit auto-rebases non-overlapping manual changes", async () => {
  const root = await workspace();
  try {
    const bundle = createBundle();
    await initializeConfigDocument({ bundle, scope: "workspace", workspaceRoot: root, ...noUser });
    const opened = await openDcsEditorSession({
      bundle,
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    const session = applyDcsEditorSessionPatch(opened, {
      operations: [{ op: "set", path: "/telemetry", value: true }],
    });

    const current = await readConfigDocumentForEdit({
      bundle,
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    await mutateConfigDocument({
      bundle,
      expectedRevision: current.documentRevision,
      patch: { operations: [{ op: "set", path: "/editor/theme", value: "light" }] },
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });

    const result = await commitDcsEditorSession({
      bundle,
      scope: "workspace",
      session,
      workspaceRoot: root,
      ...noUser,
    });
    expect(result.kind).toBe("committed");
    if (result.kind === "committed") {
      expect(result.rebase).not.toBe("direct");
      expect(result.result.document).toMatchObject({ editor: { theme: "light" }, telemetry: true });
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("server commit returns a conflict instead of replacing a same-path manual edit", async () => {
  const root = await workspace();
  try {
    const bundle = createBundle();
    await initializeConfigDocument({ bundle, scope: "workspace", workspaceRoot: root, ...noUser });
    const opened = await openDcsEditorSession({
      bundle,
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    const session = applyDcsEditorSessionPatch(opened, {
      operations: [{ op: "set", path: "/telemetry", value: true }],
    });

    const current = await readConfigDocumentForEdit({
      bundle,
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    await mutateConfigDocument({
      bundle,
      expectedRevision: current.documentRevision,
      patch: { operations: [{ op: "set", path: "/telemetry", value: false }] },
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });

    const result = await commitDcsEditorSession({
      bundle,
      scope: "workspace",
      session,
      workspaceRoot: root,
      ...noUser,
    });
    expect(result.kind).toBe("conflict");
    if (result.kind === "conflict") {
      expect(result.rebase.conflicts[0]?.path).toBe("/telemetry");
      expect(result.latest.document.telemetry).toBe(false);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("profile editor sessions remain bound to the selected overlay", async () => {
  const root = await workspace();
  try {
    const bundle = createBundle();
    await initializeConfigDocument({
      bundle,
      profile: "production",
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    const opened = await openDcsEditorSession({
      bundle,
      profile: "production",
      scope: "workspace",
      workspaceRoot: root,
      ...noUser,
    });
    expect(opened.profile).toBe("production");
    expect(opened.model.profile).toBe("production");

    const session = applyDcsEditorSessionPatch(opened, {
      operations: [{ op: "set", path: "/telemetry", value: true }],
    });
    const committed = await commitDcsEditorSession({
      bundle,
      profile: "production",
      scope: "workspace",
      session,
      workspaceRoot: root,
      ...noUser,
    });
    expect(committed.kind).toBe("committed");

    await expect(
      commitDcsEditorSession({
        bundle,
        scope: "workspace",
        session,
        workspaceRoot: root,
        ...noUser,
      }),
    ).rejects.toThrow("profile does not match");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
