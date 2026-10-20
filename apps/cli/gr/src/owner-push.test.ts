import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  dispatchGrOwnerPush,
  dispatchGrOwnerCommit,
  withGrOwnerPushHost,
  withGrOwnerCommitHost,
  type GrOwnerPushHost,
} from "./owner-push";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "gr-owner-dispatch-"));
  roots.push(root);
  let calls = 0;
  const host = {
    operation: "repo.push",
    contextRoot: root,
    ownerUid: 1000,
    inspect: async () => ({ operation: "gr.campaign.push", fixtureOnly: true }),
    execute: async () => {
      calls++;
      return { fixtureOnly: true };
    },
  } as unknown as GrOwnerPushHost;
  return { root, host, calls: () => calls };
}
const terminal = { tty: () => true, uid: () => 1000 };
test("uncomposed native owner push previews blocked and refuses apply without importing source or spawning a shell", async () => {
  expect(await dispatchGrOwnerPush({ root: "/", apply: false, interactive: false })).toMatchObject({
    status: "blocked",
    reason: "GR_OWNER_PUSH_HOST_NOT_ADMITTED",
  });
  await expect(dispatchGrOwnerPush({ root: "/", apply: true, interactive: true })).rejects.toThrow(
    "HOST_NOT_ADMITTED",
  );
});
test("owner dispatch requires explicit interactive apply, exact UID/TTY and bound context", async () => {
  const f = await fixture();
  const input = { root: f.root, apply: true, interactive: true };
  for (const [interactive, tty, uid] of [
    [false, true, 1000],
    [true, false, 1000],
    [true, true, 999],
    [true, true, 0],
  ] as const)
    await expect(
      dispatchGrOwnerPush({ ...input, interactive }, f.host, { tty: () => tty, uid: () => uid }),
    ).rejects.toThrow("OWNER_TTY_REQUIRED");
  await expect(dispatchGrOwnerPush({ ...input, root: "/" }, f.host, terminal)).rejects.toThrow(
    "CONTEXT_MISMATCH",
  );
  await dispatchGrOwnerPush({ ...input, apply: false, interactive: false }, f.host, terminal);
  expect(f.calls()).toBe(0);
  await dispatchGrOwnerPush(input, f.host, terminal);
  expect(f.calls()).toBe(1);
});
test("commit and push are distinct bound projections and cannot substitute each other's operation", async () => {
  const f = await fixture();
  expect(
    await dispatchGrOwnerCommit({ root: f.root, apply: false, interactive: false }),
  ).toMatchObject({ reason: "GR_OWNER_COMMIT_HOST_NOT_ADMITTED" });
  await expect(
    dispatchGrOwnerCommit({ root: f.root, apply: true, interactive: true }),
  ).rejects.toThrow("HOST_NOT_ADMITTED");
  await expect(
    dispatchGrOwnerCommit({ root: f.root, apply: true, interactive: true }, f.host, terminal),
  ).rejects.toThrow("OPERATION_MISMATCH");
  const commit = { ...f.host, operation: "repo.commit" as const };
  await withGrOwnerCommitHost(commit, async () => {
    await expect(
      dispatchGrOwnerCommit({ root: f.root, apply: true, interactive: false }, undefined, terminal),
    ).rejects.toThrow("OWNER_TTY_REQUIRED");
    await dispatchGrOwnerCommit(
      { root: f.root, apply: true, interactive: true },
      undefined,
      terminal,
    );
  });
  expect(f.calls()).toBe(1);
  expect(
    await dispatchGrOwnerCommit({ root: f.root, apply: false, interactive: false }),
  ).toMatchObject({ status: "blocked" });
});

test("concurrent CLI host composition does not share bindings or leak into later invocations", async () => {
  const [a, b] = await Promise.all([fixture(), fixture()]);
  await Promise.all(
    [a, b].map((f) =>
      withGrOwnerPushHost(f.host, async () => {
        await Promise.resolve();
        await dispatchGrOwnerPush(
          { root: f.root, apply: true, interactive: true },
          undefined,
          terminal,
        );
      }),
    ),
  );
  expect(a.calls()).toBe(1);
  expect(b.calls()).toBe(1);
  expect(
    await dispatchGrOwnerPush({ root: a.root, apply: false, interactive: false }),
  ).toMatchObject({ status: "blocked" });
});
