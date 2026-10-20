import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadFileHandoff } from "@reliverse/rse-handoff/files";

import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { runRequiredGrGit } from "./git";
import { fingerprintGrJson } from "./json";
import { type GrEffectKind, type GrSnapshot } from "./model";
import { createGrPatch } from "./patch";
import { assertGrArtifactId, assertGrRelativePath, resolveGrRoot } from "./paths";
import { resolveGrDurablePrivatePath } from "./private-root";
import { isGrHardPrivatePath } from "./public-surface";
import { createGrAcceptedRevisionSnapshot, createGrSnapshot, parseGrSnapshot } from "./snapshot";

export const GR_WORK_TURN_SCHEMA = "gr.work-turn.v0" as const;
const readEffects = ["filesystem.read", "git.read"] as const;
const snapshotEffects = [...readEffects, "git.write"] as const;
const writeEffects = [...snapshotEffects, "artifact.write"] as const;
export type GrWorkTurn = {
  schemaVersion: typeof GR_WORK_TURN_SCHEMA;
  id: string;
  state: "active" | "completed" | "superseded";
  actor: string;
  startedAt: string;
  finishedAt?: string;
  scope: readonly string[];
  scopeExtensions?: readonly GrWorkTurnScopeExtension[];
  indexReconciliations?: readonly GrWorkTurnIndexReconciliation[];
  baseline: GrSnapshot;
  handoff?: { root: string; global: true; handoffId: string; stageId: string; stageOrder: number };
  result?: GrSnapshot;
  supersededAt?: string;
  supersession?: { rationale: string; acceptedBaseline: GrSnapshot };
  interruption?: {
    actor: string;
    rationale: string;
    writerStopped: true;
    turnFingerprint: string;
    observed: GrSnapshot;
  };
  artifacts?: {
    forward: string;
    reverse: string;
    manifest: string;
    changedPaths: number;
    patchFingerprint: string;
  };
};
export type GrWorkTurnScopeExtension = {
  readonly id: string;
  readonly addedPaths: readonly string[];
  readonly rationale: string;
  readonly observedSnapshotId: string;
  readonly appliedAt: string;
};

export type GrWorkTurnIndexReconciliation = {
  readonly id: string;
  readonly workTurnId: string;
  readonly turnFingerprint: string;
  readonly previousIndexTree: string;
  readonly observed: GrSnapshot;
  readonly actor: string;
  readonly rationale: string;
  readonly indexChangeConfirmed: true;
  readonly appliedAt: string;
};
function expectedWorkTurnIndex(turn: GrWorkTurn): string {
  return turn.indexReconciliations?.at(-1)?.observed.indexTree.oid ?? turn.baseline.indexTree.oid;
}
function sameWorkTurnHead(a: GrSnapshot, b: GrSnapshot): boolean {
  return fingerprintGrJson(a.head, "gr.wt-head.v0") === fingerprintGrJson(b.head, "gr.wt-head.v0");
}
function indexReconciliationId(value: Omit<GrWorkTurnIndexReconciliation, "id" | "appliedAt">) {
  return `index-${fingerprintGrJson(value, "gr.wt-index-reconciliation.v0").slice(7, 39)}`;
}

type Options = { root: string; grantedEffects?: readonly GrEffectKind[] };
function fail(message: string): never {
  throw new GrError("GR_STALE_STATE", message);
}
function absent(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}
async function atomicJson(file: string, value: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}
async function storage(root: string) {
  return resolveGrDurablePrivatePath(root, ["work-turns"]);
}
async function locked<T>(root: string, action: (directory: string) => Promise<T>): Promise<T> {
  const directory = await storage(root);
  await mkdir(directory, { recursive: true });
  const lock = path.join(directory, "mutation.lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      fail(
        "Work Turn mutation is locked; inspect interrupted execution before removing mutation.lock.",
      );
    throw error;
  }
  try {
    return await action(directory);
  } finally {
    await rm(lock, { recursive: true });
  }
}
async function readTurn(directory: string, root: string): Promise<GrWorkTurn | undefined> {
  let value: GrWorkTurn;
  try {
    value = JSON.parse(await readFile(path.join(directory, "current.json"), "utf8"));
  } catch (error) {
    if (absent(error)) return undefined;
    throw error;
  }
  if (
    value.schemaVersion !== GR_WORK_TURN_SCHEMA ||
    !["active", "completed", "superseded"].includes(value.state)
  )
    fail("Invalid Work Turn record.");
  assertGrArtifactId(value.id);
  const baseline = parseGrSnapshot(value.baseline);
  if (baseline.repository.root !== root) fail("Work Turn belongs to another repository.");
  if (!Array.isArray(value.scope)) fail("Invalid Work Turn scope.");
  value.scope.forEach(assertGrRelativePath);
  if (value.scopeExtensions !== undefined) {
    if (!Array.isArray(value.scopeExtensions)) fail("Invalid Work Turn scope-extension history.");
    const scope = new Set(value.scope);
    for (const extension of value.scopeExtensions) {
      if (
        !extension ||
        !/^scope-[a-f0-9]{32}$/u.test(extension.id) ||
        typeof extension.rationale !== "string" ||
        !extension.rationale.trim() ||
        typeof extension.observedSnapshotId !== "string" ||
        typeof extension.appliedAt !== "string" ||
        !Array.isArray(extension.addedPaths)
      ) {
        fail("Invalid Work Turn scope-extension receipt.");
      }
      for (const relativePath of extension.addedPaths) {
        assertGrRelativePath(relativePath);
        if (isGrHardPrivatePath(relativePath) || !scope.has(relativePath)) {
          fail("Work Turn scope-extension receipt does not match the current public scope.");
        }
      }
    }
  }
  if (value.indexReconciliations !== undefined) {
    if (!Array.isArray(value.indexReconciliations)) fail("Invalid index-reconciliation history.");
    let previousIndex = baseline.indexTree.oid;
    const ids = new Set<string>();
    for (const receipt of value.indexReconciliations) {
      const observed = parseGrSnapshot(receipt.observed);
      const { id, appliedAt, ...semantic } = receipt;
      if (
        id !== indexReconciliationId(semantic) ||
        ids.has(id) ||
        receipt.workTurnId !== value.id ||
        receipt.actor !== value.actor ||
        typeof receipt.rationale !== "string" ||
        !receipt.rationale.trim() ||
        typeof receipt.turnFingerprint !== "string" ||
        !receipt.turnFingerprint ||
        typeof appliedAt !== "string" ||
        !appliedAt ||
        receipt.indexChangeConfirmed !== true ||
        receipt.previousIndexTree !== previousIndex ||
        observed.indexTree.oid === previousIndex ||
        observed.repository.fingerprint !== baseline.repository.fingerprint ||
        !sameWorkTurnHead(observed, baseline)
      )
        fail("Invalid Work Turn index-reconciliation receipt.");
      ids.add(id);
      previousIndex = observed.indexTree.oid;
    }
  }
  if (value.interruption !== undefined) {
    const recovery = value.interruption;
    if (
      value.state !== "superseded" ||
      value.supersession !== undefined ||
      recovery.writerStopped !== true ||
      typeof recovery.actor !== "string" ||
      !recovery.actor.trim() ||
      typeof recovery.rationale !== "string" ||
      !recovery.rationale.trim() ||
      typeof recovery.turnFingerprint !== "string"
    ) {
      fail("Invalid interrupted Work Turn recovery record.");
    }
    if (parseGrSnapshot(recovery.observed).repository.root !== root)
      fail("Interrupted Work Turn observation belongs to another repository.");
  }
  return value;
}
async function handoffBinding(
  root: string,
  selectedStage?: string,
): Promise<NonNullable<GrWorkTurn["handoff"]>> {
  const canonical = await resolveGrRoot(root);
  const handoff = await loadFileHandoff(canonical);
  const policy = handoff.policy;
  if (policy.global !== true || policy.scope !== "global" || typeof policy.handoffId !== "string")
    fail("Work Turn requires a Global Handoff file profile with global=true.");
  const stage =
    selectedStage === undefined
      ? handoff.stages.find((item) => item.header.status === "active")
      : handoff.stages.find((item) => item.id === selectedStage);
  if (!stage || !Number.isInteger(stage.header.sequence))
    fail("Work Turn Handoff stage is unknown or has no accepted sequence.");
  return {
    root: canonical,
    global: true,
    handoffId: policy.handoffId,
    stageId: stage.id,
    stageOrder: stage.header.sequence!,
  };
}

/** One cooperative writer per repository. Scope cannot prove attribution of writes bypassing GR. */
export async function beginGrWorkTurn(
  options: Options & {
    id: string;
    actor: string;
    scope?: readonly string[];
    baseline?: GrSnapshot;
    acceptedHead?: boolean;
    handoffRoot?: string;
    stageId?: string;
  },
): Promise<GrWorkTurn> {
  assertGrEffects(writeEffects, options.grantedEffects);
  assertGrArtifactId(options.id);
  if (!options.actor.trim()) fail("Work Turn actor is required.");
  const root = await resolveGrRoot(options.root);
  const scope = [...new Set((options.scope ?? []).map(assertGrRelativePath))].sort();
  if (scope.some(isGrHardPrivatePath)) fail("Private paths cannot enter Work Turn source scope.");
  return locked(root, async (directory) => {
    const previous = await readTurn(directory, root);
    if (previous?.state === "active") fail(`Work Turn ${previous.id} is already active.`);
    const handoff = options.handoffRoot
      ? await handoffBinding(options.handoffRoot, options.stageId)
      : undefined;
    if (options.stageId && !handoff) fail("--stage requires --handoff.");
    if (options.baseline !== undefined && options.acceptedHead === true) {
      fail("Work Turn baseline and --accepted-head are mutually exclusive.");
    }
    // Accepted HEAD is an explicit recovery boundary after a stale turn was superseded.
    // The real index must already match HEAD so staged bytes are never silently re-attributed.
    const baseline =
      options.acceptedHead === true
        ? await createGrAcceptedRevisionSnapshot({
            root,
            role: "baseline",
            grantedEffects: readEffects,
          })
        : options.baseline
          ? parseGrSnapshot(options.baseline)
          : await createGrSnapshot({
              root,
              role: "baseline",
              dirtyPolicy: "capture",
              grantedEffects: snapshotEffects,
            });
    if (
      baseline.repository.root !== root ||
      baseline.scope.kind !== "workspace" ||
      baseline.role !== "baseline"
    )
      fail("Work Turn requires a whole baseline from this repository.");
    if (options.acceptedHead === true) {
      const observed = await createGrSnapshot({
        root,
        role: "explicit",
        dirtyPolicy: "capture",
        grantedEffects: snapshotEffects,
      });
      if (observed.indexTree.oid !== baseline.indexTree.oid)
        fail("Accepted-HEAD Work Turn requires the real index to match HEAD.");
    } else if (baseline.origin.kind !== "live-worktree") {
      fail("Adopted Work Turn baselines must originate from a live worktree.");
    }
    const turn: GrWorkTurn = {
      schemaVersion: GR_WORK_TURN_SCHEMA,
      id: options.id,
      state: "active",
      actor: options.actor,
      startedAt: new Date().toISOString(),
      scope,
      baseline,
      ...(handoff ? { handoff } : {}),
    };
    // Exclusive reservation survives interruption and prevents reusing an artifact identity.
    await mkdir(path.join(directory, turn.id));
    await atomicJson(path.join(directory, turn.id, "begin.json"), turn);
    await atomicJson(path.join(directory, "current.json"), turn);
    return turn;
  });
}

export async function inspectGrWorkTurn(options: Options): Promise<GrWorkTurn | undefined> {
  assertGrEffects(readEffects, options.grantedEffects);
  const root = await resolveGrRoot(options.root);
  return readTurn(await storage(root), root);
}

export interface GrWorkTurnScopeExtensionPlan {
  readonly workTurnId: string;
  readonly rationale: string;
  readonly currentScope: readonly string[];
  readonly addedPaths: readonly string[];
  readonly observedSnapshotId: string;
}

async function planWorkTurnScopeExtension(
  options: Options & { readonly paths: readonly string[]; readonly rationale: string },
  turn: GrWorkTurn,
): Promise<GrWorkTurnScopeExtensionPlan> {
  if (!options.rationale.trim()) fail("Work Turn scope extension requires a rationale.");
  if (turn.state !== "active") fail("Only an active Work Turn scope can be extended.");
  if (turn.scope.length === 0) {
    fail("A workspace-scoped Work Turn already covers every public path and cannot be extended.");
  }
  const requested = [...new Set(options.paths.map(assertGrRelativePath))].sort();
  if (requested.length === 0)
    fail("Work Turn scope extension requires at least one exact changed path.");
  if (requested.some(isGrHardPrivatePath))
    fail("Private paths cannot enter Work Turn source scope.");
  const alreadyScoped = new Set(turn.scope);
  const addedPaths = requested.filter((entry) => !alreadyScoped.has(entry));
  if (addedPaths.length === 0) fail("Work Turn scope extension does not add any paths.");

  const observed = await createGrSnapshot({
    root: options.root,
    role: "explicit",
    dirtyPolicy: "capture",
    grantedEffects: snapshotEffects,
  });
  if (
    fingerprintGrJson(observed.head, "gr.wt-head.v0") !==
      fingerprintGrJson(turn.baseline.head, "gr.wt-head.v0") ||
    observed.indexTree.oid !== expectedWorkTurnIndex(turn)
  ) {
    fail("Work Turn scope cannot be extended after HEAD or real index changes.");
  }
  const patch = await createGrPatch(turn.baseline, observed, { grantedEffects: ["git.read"] });
  const changedPaths = new Set(
    patch.diff.files.flatMap((file) => [
      file.path,
      ...(file.originalPath ? [file.originalPath] : []),
    ]),
  );
  const unobserved = addedPaths.filter((entry) => !changedPaths.has(entry));
  if (unobserved.length > 0) {
    fail(
      `Work Turn scope can extend only to exact paths changed since baseline: ${unobserved.join(", ")}`,
    );
  }
  return Object.freeze({
    workTurnId: turn.id,
    rationale: options.rationale.trim(),
    currentScope: Object.freeze([...turn.scope]),
    addedPaths: Object.freeze(addedPaths),
    observedSnapshotId: observed.snapshotId,
  });
}

export async function previewGrWorkTurnScopeExtension(
  options: Options & { readonly paths: readonly string[]; readonly rationale: string },
): Promise<GrWorkTurnScopeExtensionPlan> {
  assertGrEffects(readEffects, options.grantedEffects);
  const root = await resolveGrRoot(options.root);
  const turn = await readTurn(await storage(root), root);
  if (!turn) fail("No Work Turn exists. Run gr wt begin first.");
  return planWorkTurnScopeExtension({ ...options, root }, turn);
}

export async function extendGrWorkTurnScope(
  options: Options & { readonly paths: readonly string[]; readonly rationale: string },
): Promise<{ readonly turn: GrWorkTurn; readonly extension: GrWorkTurnScopeExtension }> {
  assertGrEffects(writeEffects, options.grantedEffects);
  const root = await resolveGrRoot(options.root);
  return locked(root, async (directory) => {
    const turn = await readTurn(directory, root);
    if (!turn) fail("No Work Turn exists. Run gr wt begin first.");
    const rationale = options.rationale.trim();
    const requestedPaths = [...new Set(options.paths.map(assertGrRelativePath))].sort();
    const id = `scope-${fingerprintGrJson({ workTurnId: turn.id, addedPaths: requestedPaths, rationale }, "gr.wt-scope-extension.v0").slice("sha256:".length, "sha256:".length + 32)}`;
    const existing = turn.scopeExtensions?.find((entry) => entry.id === id);
    if (existing) return { turn, extension: existing };
    const plan = await planWorkTurnScopeExtension({ ...options, root }, turn);
    const extension: GrWorkTurnScopeExtension = Object.freeze({
      id,
      addedPaths: plan.addedPaths,
      rationale: plan.rationale,
      observedSnapshotId: plan.observedSnapshotId,
      appliedAt: new Date().toISOString(),
    });
    const extended: GrWorkTurn = {
      ...turn,
      scope: Object.freeze([...new Set([...turn.scope, ...plan.addedPaths])].sort()),
      scopeExtensions: Object.freeze([...(turn.scopeExtensions ?? []), extension]),
    };
    await atomicJson(path.join(directory, turn.id, `${id}.json`), extension);
    await atomicJson(path.join(directory, "current.json"), extended);
    return { turn: extended, extension };
  });
}

export interface GrWorkTurnIndexPreview {
  readonly workTurnId: string;
  readonly turnFingerprint: string;
  readonly previousIndexTree: string;
  readonly observed: GrSnapshot;
  readonly changedIndexPaths: readonly string[];
}
async function indexReconciliationPreview(
  root: string,
  turn: GrWorkTurn,
): Promise<GrWorkTurnIndexPreview> {
  if (turn.state !== "active") fail("Index reconciliation requires an active Work Turn.");
  const observed = await createGrSnapshot({
    root,
    role: "explicit",
    dirtyPolicy: "capture",
    grantedEffects: snapshotEffects,
  });
  if (!sameWorkTurnHead(observed, turn.baseline))
    fail("Index reconciliation cannot accept HEAD drift.");
  const previousIndexTree = expectedWorkTurnIndex(turn);
  if (observed.indexTree.oid === previousIndexTree)
    fail("No unacknowledged index change to reconcile.");
  const paths = (
    await runRequiredGrGit(root, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-only",
      "-z",
      previousIndexTree,
      observed.indexTree.oid,
    ])
  )
    .split("\0")
    .filter((entry) => entry && !isGrHardPrivatePath(entry));
  return {
    workTurnId: turn.id,
    turnFingerprint: fingerprintGrJson(turn, "gr.wt-index-turn.v0"),
    previousIndexTree,
    observed,
    changedIndexPaths: paths,
  };
}
/** Read-only Git state observation; snapshot objects are private evidence, not a new baseline. */
export async function previewGrWorkTurnIndexReconciliation(
  options: Options,
): Promise<GrWorkTurnIndexPreview> {
  assertGrEffects(readEffects, options.grantedEffects);
  const root = await resolveGrRoot(options.root);
  const turn = await readTurn(await storage(root), root);
  if (!turn) fail("No Work Turn exists.");
  return indexReconciliationPreview(root, turn);
}

/** Acknowledge an explicitly confirmed index event, never stage/unstage or reattribute baseline work. */
export async function reconcileGrWorkTurnIndex(
  options: Options & {
    readonly workTurnId: string;
    readonly turnFingerprint: string;
    readonly observedFingerprint: string;
    readonly actor: string;
    readonly rationale: string;
    readonly indexChangeConfirmed: true;
  },
): Promise<{ readonly turn: GrWorkTurn; readonly receipt: GrWorkTurnIndexReconciliation }> {
  assertGrEffects(writeEffects, options.grantedEffects);
  if (
    options.indexChangeConfirmed !== true ||
    !options.actor?.trim() ||
    !options.rationale?.trim() ||
    !options.workTurnId ||
    !options.turnFingerprint ||
    !options.observedFingerprint
  )
    fail(
      "Index reconciliation requires confirmed index change, declared actor, rationale and exact preview pins.",
    );
  const root = await resolveGrRoot(options.root);
  return locked(root, async (directory) => {
    const turn = await readTurn(directory, root);
    if (
      !turn ||
      turn.state !== "active" ||
      turn.id !== options.workTurnId ||
      turn.actor !== options.actor.trim()
    )
      fail("Index reconciliation must match the active Work Turn and its declared writer.");
    const prior = turn.indexReconciliations?.find(
      (r) =>
        r.turnFingerprint === options.turnFingerprint &&
        r.observed.snapshotFingerprint === options.observedFingerprint,
    );
    if (prior) {
      if (
        prior.actor !== options.actor.trim() ||
        prior.rationale !== options.rationale.trim() ||
        turn.indexReconciliations?.at(-1)?.id !== prior.id
      )
        fail("Index reconciliation retry intent differs from retained history.");
      const observed = await createGrSnapshot({
        root,
        role: "explicit",
        dirtyPolicy: "capture",
        grantedEffects: snapshotEffects,
      });
      if (observed.snapshotFingerprint !== prior.observed.snapshotFingerprint)
        fail("Index reconciliation retry observation changed; inspect again.");
      return { turn, receipt: prior };
    }
    const preview = await indexReconciliationPreview(root, turn);
    if (
      preview.turnFingerprint !== options.turnFingerprint ||
      preview.observed.snapshotFingerprint !== options.observedFingerprint
    )
      fail("Index reconciliation preview is stale; inspect again.");
    const semantic = {
      workTurnId: turn.id,
      turnFingerprint: preview.turnFingerprint,
      previousIndexTree: preview.previousIndexTree,
      observed: preview.observed,
      actor: options.actor.trim(),
      rationale: options.rationale.trim(),
      indexChangeConfirmed: true as const,
    };
    let receipt: GrWorkTurnIndexReconciliation = {
      ...semantic,
      id: indexReconciliationId(semantic),
      appliedAt: new Date().toISOString(),
    };
    const receiptPath = path.join(directory, turn.id, `${receipt.id}.json`);
    try {
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const retained = JSON.parse(
        await readFile(receiptPath, "utf8"),
      ) as GrWorkTurnIndexReconciliation;
      const { id, appliedAt: _appliedAt, ...retainedSemantic } = retained;
      if (
        id !== receipt.id ||
        fingerprintGrJson(retainedSemantic, "gr.wt-index-receipt.v0") !==
          fingerprintGrJson(semantic, "gr.wt-index-receipt.v0")
      )
        fail("Retained index receipt conflicts with this reconciliation.");
      receipt = retained;
    }
    const reconciled: GrWorkTurn = {
      ...turn,
      indexReconciliations: [...(turn.indexReconciliations ?? []), receipt],
    };
    await atomicJson(path.join(directory, "current.json"), reconciled);
    return { turn: reconciled, receipt };
  });
}

export async function finishGrWorkTurn(options: Options): Promise<GrWorkTurn> {
  assertGrEffects(writeEffects, options.grantedEffects);
  const root = await resolveGrRoot(options.root);
  return locked(root, async (directory) => {
    const turn = await readTurn(directory, root);
    if (!turn) fail("No Work Turn exists. Run gr wt begin first.");
    if (turn.state === "completed") return turn;
    if (turn.state === "superseded")
      fail(`Work Turn ${turn.id} was superseded; begin a new Work Turn.`);
    const result = await createGrSnapshot({
      root,
      role: "result",
      dirtyPolicy: "capture",
      grantedEffects: snapshotEffects,
    });
    if (
      fingerprintGrJson(result.head, "gr.wt-head.v0") !==
        fingerprintGrJson(turn.baseline.head, "gr.wt-head.v0") ||
      result.indexTree.oid !== expectedWorkTurnIndex(turn)
    )
      fail("HEAD or real index changed during the Work Turn.");
    const inside = (file: string) =>
      turn.scope.length === 0 ||
      turn.scope.some((prefix) => file === prefix || file.startsWith(`${prefix}/`));
    const fullPatch = await createGrPatch(turn.baseline, result, { grantedEffects: ["git.read"] });
    const crossScopeMoves = fullPatch.diff.files.filter(
      (file) =>
        file.originalPath !== undefined && inside(file.path) !== inside(file.originalPath),
    );
    if (crossScopeMoves.length)
      fail(
        `Work Turn has ${crossScopeMoves.length} rename/copy changes crossing its declared scope.`,
      );
    const patch =
      turn.scope.length === 0
        ? fullPatch
        : await createGrPatch(turn.baseline, result, {
            grantedEffects: ["git.read"],
            paths: turn.scope,
          });
    const target = path.join(directory, turn.id);
    const stem = `${path.basename(root)}-${turn.id}`;
    const artifacts = {
      forward: path.join(target, `${stem}.patch`),
      reverse: path.join(target, `${stem}.reverse.patch`),
      manifest: path.join(target, "manifest.json"),
      changedPaths: patch.diff.files.length,
      patchFingerprint: patch.patchFingerprint,
    };
    // Deterministic files can be retried after interrupted writes; completion is the atomic record.
    await writeFile(artifacts.forward, patch.forward.content);
    await writeFile(artifacts.reverse, patch.reverse.content);
    const completed: GrWorkTurn = {
      ...turn,
      state: "completed",
      finishedAt: new Date().toISOString(),
      result,
      artifacts,
    };
    await atomicJson(artifacts.manifest, {
      ...completed,
      files: patch.diff.files,
      forwardFingerprint: patch.forward.fingerprint,
      reverseFingerprint: patch.reverse.fingerprint,
      retention: "patch-only; snapshot objects are ephemeral",
      attribution: "cooperative-single-writer",
    });
    await atomicJson(path.join(directory, "current.json"), completed);
    return completed;
  });
}

/** Close stale evidence only when a newer accepted HEAD descends from its original HEAD. */
export async function supersedeGrWorkTurn(
  options: Options & { readonly acceptedHead: true; readonly rationale: string },
): Promise<GrWorkTurn> {
  assertGrEffects(writeEffects, options.grantedEffects);
  if (options.rationale.trim().length === 0) fail("Work Turn supersession requires a rationale.");
  const root = await resolveGrRoot(options.root);
  return locked(root, async (directory) => {
    const turn = await readTurn(directory, root);
    if (!turn) fail("No Work Turn exists. Run gr wt begin first.");
    if (turn.state === "completed" || turn.state === "superseded") return turn;
    const acceptedBaseline = await createGrAcceptedRevisionSnapshot({
      root,
      role: "baseline",
      grantedEffects: readEffects,
    });
    const observed = await createGrSnapshot({
      root,
      role: "explicit",
      dirtyPolicy: "capture",
      grantedEffects: snapshotEffects,
    });
    if (observed.indexTree.oid !== acceptedBaseline.indexTree.oid) {
      fail("Work Turn supersession requires the real index to match accepted HEAD.");
    }
    const previousCommit = turn.baseline.head.commit?.oid;
    const acceptedCommit = acceptedBaseline.head.commit?.oid;
    if (
      previousCommit === undefined ||
      acceptedCommit === undefined ||
      previousCommit === acceptedCommit
    ) {
      fail("Work Turn supersession requires a newer accepted HEAD.");
    }
    try {
      await runRequiredGrGit(root, ["merge-base", "--is-ancestor", previousCommit, acceptedCommit]);
    } catch {
      fail("Accepted HEAD must descend from the Work Turn baseline HEAD.");
    }
    const superseded: GrWorkTurn = {
      ...turn,
      state: "superseded",
      supersededAt: new Date().toISOString(),
      supersession: { acceptedBaseline, rationale: options.rationale.trim() },
    };
    const target = path.join(directory, turn.id);
    await atomicJson(path.join(target, "superseded.json"), superseded);
    await atomicJson(path.join(directory, "current.json"), superseded);
    return superseded;
  });
}

export type GrWorkTurnRecoveryPreview = {
  workTurnId: string;
  turnFingerprint: string;
  observed: GrSnapshot;
};

async function interruptedRecoveryPreview(root: string, directory: string) {
  const turn = await readTurn(directory, root);
  if (!turn || turn.state !== "active") fail("Recovery requires an active Work Turn.");
  const observed = await createGrSnapshot({
    root,
    role: "explicit",
    dirtyPolicy: "capture",
    grantedEffects: snapshotEffects,
  });
  return {
    workTurnId: turn.id,
    turnFingerprint: fingerprintGrJson(turn, "gr.wt-recovery.v0"),
    observed,
  };
}

/** Capture exact recovery pins without closing the interrupted writer or changing its baseline. */
export async function previewGrWorkTurnRecovery(
  options: Options,
): Promise<GrWorkTurnRecoveryPreview> {
  assertGrEffects(snapshotEffects, options.grantedEffects);
  const root = await resolveGrRoot(options.root);
  return interruptedRecoveryPreview(root, await storage(root));
}

/** Retire interrupted evidence, not its work; no accepted HEAD or successful patch is implied. */
export async function recoverInterruptedGrWorkTurn(
  options: Options & {
    workTurnId: string;
    turnFingerprint: string;
    observedFingerprint: string;
    writerStopped: true;
    actor: string;
    rationale: string;
  },
): Promise<GrWorkTurn> {
  assertGrEffects(writeEffects, options.grantedEffects);
  if (options.writerStopped !== true || !options.actor.trim() || !options.rationale.trim())
    fail("Recovery requires stopped-writer confirmation, declared actor and rationale.");
  const root = await resolveGrRoot(options.root);
  return locked(root, async (directory) => {
    const turn = await readTurn(directory, root);
    if (turn?.id === options.workTurnId && turn.state === "superseded" && turn.interruption) {
      const prior = turn.interruption;
      if (
        prior.turnFingerprint === options.turnFingerprint &&
        prior.observed.snapshotFingerprint === options.observedFingerprint &&
        prior.actor === options.actor.trim() &&
        prior.rationale === options.rationale.trim()
      )
        return turn;
      fail("Recovery retry does not match the retained interrupted operation.");
    }
    const preview = await interruptedRecoveryPreview(root, directory);
    if (
      preview.workTurnId !== options.workTurnId ||
      preview.turnFingerprint !== options.turnFingerprint ||
      preview.observed.snapshotFingerprint !== options.observedFingerprint
    )
      fail("Work Turn or workspace changed since recovery preview.");
    const recovered: GrWorkTurn = {
      ...turn!,
      state: "superseded",
      supersededAt: new Date().toISOString(),
      interruption: {
        actor: options.actor.trim(),
        rationale: options.rationale.trim(),
        writerStopped: true,
        turnFingerprint: preview.turnFingerprint,
        observed: preview.observed,
      },
    };
    await atomicJson(path.join(directory, recovered.id, "superseded.json"), recovered);
    await atomicJson(path.join(directory, "current.json"), recovered);
    return recovered;
  });
}

/** Bounded default projection deliberately excludes full snapshots and patch bytes. */
export function summarizeGrWorkTurn(turn: GrWorkTurn | undefined) {
  return turn
    ? {
        schemaVersion: GR_WORK_TURN_SCHEMA,
        id: turn.id,
        state: turn.state,
        actor: turn.actor,
        scope: turn.scope,
        baseline: turn.baseline.snapshotId,
        handoff: turn.handoff,
        artifacts: turn.artifacts,
        interruption: turn.interruption
          ? {
              actor: turn.interruption.actor,
              rationale: turn.interruption.rationale,
              observedSnapshotId: turn.interruption.observed.snapshotId,
              writerStopped: turn.interruption.writerStopped,
            }
          : undefined,
        indexReconciliations: (turn.indexReconciliations ?? []).map((receipt) => ({
          id: receipt.id,
          actor: receipt.actor,
          rationale: receipt.rationale,
          previousIndexTree: receipt.previousIndexTree,
          indexTree: receipt.observed.indexTree.oid,
          observedSnapshotId: receipt.observed.snapshotId,
          appliedAt: receipt.appliedAt,
        })),
        scopeExtensions: (turn.scopeExtensions ?? []).map((extension) => ({
          id: extension.id,
          addedPaths: extension.addedPaths,
          rationale: extension.rationale,
          observedSnapshotId: extension.observedSnapshotId,
          appliedAt: extension.appliedAt,
        })),
        supersession:
          turn.supersession === undefined
            ? undefined
            : {
                rationale: turn.supersession.rationale,
                acceptedBaseline: turn.supersession.acceptedBaseline.snapshotId,
              },
      }
    : { schemaVersion: GR_WORK_TURN_SCHEMA, state: "none" };
}
