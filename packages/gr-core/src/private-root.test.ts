import { expect, test } from "bun:test";
import path from "node:path";

import { resolveGrPrivateRoot } from "./private-root";

test("GR private root defaults below repository .private", () => {
  const previous = process.env.RELIVERSE_PRIVATE_ROOT;
  delete process.env.RELIVERSE_PRIVATE_ROOT;
  try {
    expect(resolveGrPrivateRoot("/work/repo", { env: {} })).toBe(
      path.resolve("/work/repo/.private/reliverse/gr"),
    );
  } finally {
    if (previous === undefined) delete process.env.RELIVERSE_PRIVATE_ROOT;
    else process.env.RELIVERSE_PRIVATE_ROOT = previous;
  }
});

test("GR private root follows the shared private-root binding", () => {
  expect(
    resolveGrPrivateRoot("/work/repo", {
      env: { RELIVERSE_PRIVATE_ROOT: "/mnt/private/repo-a" },
    }),
  ).toBe(path.resolve("/mnt/private/repo-a/reliverse/gr"));
});

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

import { discoverRvsPrivateWorkspaceBinding } from "@reliverse/rvs-private";

import { resolveGrDurablePrivateRoot } from "./private-root";

test("GR durable private root rediscovers a persisted RVS Private workspace binding", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gr-private-binding-"));
  const workspaceRoot = path.join(root, "repo");
  const userHome = path.join(root, "home");
  const privateRoot = path.join(root, "external-private");
  await discoverRvsPrivateWorkspaceBinding({
    workspaceRoot,
    userHome,
    privateRoot,
    env: {},
    create: true,
  });
  expect(await resolveGrDurablePrivateRoot(workspaceRoot, { userHome, env: {} })).toBe(
    path.resolve(privateRoot, "reliverse/gr"),
  );
});
