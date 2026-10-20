import { realpath } from "node:fs/promises";

import {
  createCapabilityRuntime,
  defineCapEngine,
  defineCapEngineBinding,
  implementOperation,
} from "@reliverse/cap";
import type { BoundCapEngine } from "@reliverse/cap/invocation";
import { inspectGrWorkspace } from "@reliverse/gr";
import { repoStatusOperation } from "@reliverse/repo-cap";

export const GR_REPO_STATUS_ENGINE = defineCapEngine({
  schema: "reliverse.cap.engine.v0",
  engineId: "gr",
  version: "0.1.0",
  capabilityIds: ["repo"],
  provides: [{ operationId: "repo.status", modes: ["inspect"] }],
  runtimeKinds: ["builtin"],
  targetKinds: ["repository"],
});

/** Local read-only binding; conveys no write credential, release approval or protected admission. */
export function createGrRepoStatusBinding(root: string): BoundCapEngine {
  const runtime = createCapabilityRuntime({
    createServices: () => ({}),
    registrations: [
      {
        operation: repoStatusOperation,
        source: { id: "gr.repo.status", kind: "embedded" },
        implementation: implementOperation(repoStatusOperation, {
          async execute(_context, input) {
            const canonical = await realpath(root);
            if ((await realpath(input.root)) !== canonical)
              throw Error("GR_REPO_BINDING_TARGET_MISMATCH");
            const state = await inspectGrWorkspace(canonical, {
              grantedEffects: ["filesystem.read", "git.read"],
            });
            return {
              root: canonical,
              revision: state.head.commit?.oid ?? null,
              branch: state.head.ref ?? null,
              entries: state.entries.map((e) => ({
                path: e.path,
                ...(e.originalPath ? { originalPath: e.originalPath } : {}),
                kind: e.kind,
                indexStatus: e.indexStatus,
                worktreeStatus: e.worktreeStatus,
              })),
            };
          },
        }),
      },
    ],
  });
  return {
    engine: GR_REPO_STATUS_ENGINE,
    binding: defineCapEngineBinding({
      schema: "reliverse.cap.engine-binding.v0",
      bindingId: "gr.repo.status@local",
      engineId: "gr",
      capabilityId: "repo",
      operationIds: ["repo.status"],
      implementationId: "gr.repo.status",
      implementationVersion: "0.1.0",
      runtimeKind: "builtin",
      targetRef: root,
      source: { kind: "embedded", id: "gr.repo.status" },
    }),
    runtime,
  };
}
