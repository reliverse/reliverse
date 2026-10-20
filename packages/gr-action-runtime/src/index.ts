export * from "./campaign";
export * from "./review";
export * from "./reviewer-signing";
export * from "./owner-admission";
export * from "./owner-authorization";
export * from "./native-review-bridge";

import {
  executeWorkspaceRuntimeTool,
  preflightWorkspaceRuntimeTool,
  previewRseWorkspacePatch,
  type WorkspaceRuntimeContext,
  type WorkspaceRuntimeJson,
} from "@reliverse/workspace-runtime";

export const GR_REPOSITORY_PATCH_APPLY_TOOL = "gr.repository.patch.apply" as const;
const LEGACY_WORKSPACE_PATCH_TOOL = "fsg.workspace.patch.apply" as const;

function asRecord(value: WorkspaceRuntimeJson): Readonly<Record<string, WorkspaceRuntimeJson>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("GR repository patch adapter expected an object result.");
  }
  return value as Readonly<Record<string, WorkspaceRuntimeJson>>;
}

function projectPreview(value: WorkspaceRuntimeJson): WorkspaceRuntimeJson {
  const result = asRecord(value);
  const rollback = result.rollback;
  return {
    ...result,
    kind: "reliverse.gr.repository.patch.preview.v0",
    owner: "gr",
    backend: "git",
    ...(typeof rollback === "object" && rollback !== null && !Array.isArray(rollback)
      ? { rollback: { ...rollback, tool: GR_REPOSITORY_PATCH_APPLY_TOOL } }
      : {}),
  };
}

function projectReceipt(value: WorkspaceRuntimeJson): WorkspaceRuntimeJson {
  const result = asRecord(value);
  const rollback = result.rollback;
  return {
    ...result,
    kind: "reliverse.gr.repository.patch.receipt.v0",
    owner: "gr",
    backend: "git",
    ...(typeof rollback === "object" && rollback !== null && !Array.isArray(rollback)
      ? {
          rollback: {
            ...(rollback as Readonly<Record<string, WorkspaceRuntimeJson>>),
            tool: GR_REPOSITORY_PATCH_APPLY_TOOL,
          },
        }
      : {}),
  };
}

export function previewGrRepositoryPatch(
  input: Readonly<Record<string, WorkspaceRuntimeJson>>,
): WorkspaceRuntimeJson {
  return projectPreview(previewRseWorkspacePatch(input));
}

export async function preflightGrActionTool(options: {
  readonly input: Readonly<Record<string, WorkspaceRuntimeJson>>;
  readonly workspace: WorkspaceRuntimeContext;
  readonly tool: string;
}): Promise<WorkspaceRuntimeJson | undefined> {
  if (options.tool !== GR_REPOSITORY_PATCH_APPLY_TOOL) {
    throw new Error(`No GR Action Plane executor is registered for ${options.tool}.`);
  }
  const preview = await preflightWorkspaceRuntimeTool({
    ...options,
    tool: LEGACY_WORKSPACE_PATCH_TOOL,
  });
  return preview == null ? undefined : projectPreview(preview);
}

export async function executeGrActionTool(options: {
  readonly input: Readonly<Record<string, WorkspaceRuntimeJson>>;
  readonly workspace: WorkspaceRuntimeContext;
  readonly tool: string;
}): Promise<WorkspaceRuntimeJson> {
  if (options.tool !== GR_REPOSITORY_PATCH_APPLY_TOOL) {
    throw new Error(`No GR Action Plane executor is registered for ${options.tool}.`);
  }
  return projectReceipt(
    await executeWorkspaceRuntimeTool({
      ...options,
      tool: LEGACY_WORKSPACE_PATCH_TOOL,
    }),
  );
}

export function isGrActionTool(tool: string): boolean {
  return tool === GR_REPOSITORY_PATCH_APPLY_TOOL;
}
