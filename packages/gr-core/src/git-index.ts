import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const indexes = new AsyncLocalStorage<{ root: string; paths: ReadonlySet<string> }>();
/** Backend-private allocation: callers cannot nominate an arbitrary index path. */
export async function withGrSnapshotIndexes<T>(
  root: string,
  action: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), "reliverse-gr-index-"));
  try {
    return await indexes.run(
      {
        root: path.resolve(root),
        paths: new Set([
          path.join(directory, "index-state"),
          path.join(directory, "worktree-state"),
        ]),
      },
      () => action(directory),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export function isGrSnapshotIndex(root: string, index: string | undefined): boolean {
  const active = indexes.getStore();
  return (
    !!active &&
    active.root === path.resolve(root) &&
    typeof index === "string" &&
    active.paths.has(index)
  );
}
