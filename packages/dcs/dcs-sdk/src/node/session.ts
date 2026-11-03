import {
  createDcsEditorSession,
  rebaseDcsDocumentPatch,
  type DcsDocumentRebaseResult,
  type DcsEditorSession,
} from "../session";
import { resolveConfig } from "./discovery";
import {
  mutateConfigDocument,
  readConfigDocumentForEdit,
  type DcsConfigDocumentMutationOptions,
  type DcsConfigDocumentSnapshot,
  type DcsConfigWriteResult,
  type ReadDcsConfigDocumentOptions,
} from "./writer";

export interface DcsEditorSessionOpenOptions extends ReadDcsConfigDocumentOptions {}

export interface DcsEditorSessionCommitOptions extends ReadDcsConfigDocumentOptions {
  readonly session: DcsEditorSession;
}

export type DcsEditorSessionCommitResult =
  | {
      readonly kind: "committed";
      readonly rebase: "direct" | (DcsDocumentRebaseResult & { readonly kind: "rebased" });
      readonly result: DcsConfigWriteResult;
    }
  | {
      readonly kind: "conflict";
      readonly latest: DcsConfigDocumentSnapshot;
      readonly rebase: DcsDocumentRebaseResult & { readonly kind: "conflict" };
    }
  | {
      readonly kind: "noop";
      readonly latest: DcsConfigDocumentSnapshot;
    };

/** Opens a host-owned editor session for one selected persistent scope. */
export async function openDcsEditorSession(
  options: DcsEditorSessionOpenOptions,
): Promise<DcsEditorSession> {
  const [snapshot, resolution] = await Promise.all([
    readConfigDocumentForEdit(options),
    resolveConfig(options),
  ]);
  if (!resolution.ok || resolution.resolved === undefined) {
    throw new TypeError("DCS editor session requires a valid effective configuration.");
  }
  return createDcsEditorSession({
    bundle: options.bundle,
    document: {
      document: snapshot.document,
      documentRevision: snapshot.documentRevision,
      ...(resolution.effectiveRevision === undefined
        ? {}
        : { effectiveRevision: resolution.effectiveRevision }),
      semanticRevision: snapshot.semanticRevision,
    },
    ...(snapshot.profile === undefined ? {} : { profile: snapshot.profile }),
    resolved: resolution.resolved,
    scope: options.scope,
  });
}

/**
 * Server-safe commit boundary. It attempts a conservative three-way rebase
 * when the document changed since opening the session; overlapping changes are
 * returned as data instead of silently overwriting either side.
 */
export async function commitDcsEditorSession(
  options: DcsEditorSessionCommitOptions,
): Promise<DcsEditorSessionCommitResult> {
  if (options.scope !== options.session.scope) {
    throw new TypeError("DCS editor session scope does not match the commit target scope.");
  }
  if (options.bundle.$dcs.id !== options.session.$dcs.contract.id) {
    throw new TypeError("DCS editor session contract does not match the commit bundle.");
  }
  if (options.profile !== options.session.profile) {
    throw new TypeError("DCS editor session profile does not match the commit target profile.");
  }

  const latest = await readConfigDocumentForEdit(options);
  if (options.session.patch.operations.length === 0) {
    return Object.freeze({ kind: "noop" as const, latest });
  }

  if (latest.documentRevision === options.session.base.documentRevision) {
    const result = await mutateConfigDocument(
      mutationOptions(options, latest.documentRevision, options.session.patch),
    );
    return Object.freeze({ kind: "committed" as const, rebase: "direct" as const, result });
  }

  const rebase = rebaseDcsDocumentPatch({
    baseDocument: options.session.base.document,
    bundle: options.bundle,
    latestDocument: latest.document,
    patch: options.session.patch,
  });
  if (rebase.kind === "conflict") {
    return Object.freeze({ kind: "conflict" as const, latest, rebase });
  }

  const result = await mutateConfigDocument(
    mutationOptions(options, latest.documentRevision, rebase.patch),
  );
  return Object.freeze({ kind: "committed" as const, rebase, result });
}

function mutationOptions(
  options: DcsEditorSessionCommitOptions,
  expectedRevision: string,
  patch: DcsEditorSession["patch"],
): DcsConfigDocumentMutationOptions {
  const { session: _session, ...host } = options;
  return {
    ...host,
    expectedRevision,
    patch,
  };
}
