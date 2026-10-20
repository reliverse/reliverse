import { createHash } from "node:crypto";

import type { GrCampaignPlanV0 } from "./campaign";
import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { runRequiredGrGit } from "./git";
import { inspectGrWorkspace } from "./inspect";
import { fingerprintGrJson } from "./json";
import type { GrEffectKind } from "./model";
import { assertGrRelativePath } from "./paths";
import { isGrHardPrivatePath } from "./public-surface";

export interface GrCampaignReviewTreeProof {
  readonly schema: "gr.campaign-review-tree-proof.v0";
  readonly candidateTree: string;
  readonly trees: readonly {
    readonly oid: string;
    readonly entries: readonly {
      readonly mode: string;
      readonly name: string;
      readonly oid: string;
    }[];
  }[];
}

type ReviewTreeInventory = {
  readonly candidateTree: string;
  readonly scope: readonly string[];
  readonly files: readonly {
    readonly path: string;
    readonly gitBlob: string;
    readonly executable: boolean;
  }[];
};
const treeProofInvalid = () =>
  new GrError("GR_INVALID_ARTIFACT", "Review tree membership/completeness proof is invalid.");

/** Reconstruct actual Git tree-object bytes; the trusted input is the separately
 * pinned root OID, not the producer's file inventory or an export assertion. */
export function verifyGrCampaignReviewTreeProof(
  proof: GrCampaignReviewTreeProof,
  inventory: ReviewTreeInventory,
) {
  const invalid = treeProofInvalid;
  if (
    proof.schema !== "gr.campaign-review-tree-proof.v0" ||
    proof.candidateTree !== inventory.candidateTree ||
    !/^[a-f0-9]{40}$/.test(proof.candidateTree) ||
    !Array.isArray(proof.trees) ||
    !proof.trees.length ||
    proof.trees.length > 1024 ||
    Buffer.byteLength(JSON.stringify(proof)) > 1024 ** 2 ||
    !inventory.scope.length ||
    inventory.scope.length > 1024 ||
    inventory.files.length > 1024
  )
    throw invalid();
  for (const name of inventory.scope) {
    assertGrRelativePath(name);
    if (
      isGrHardPrivatePath(name) ||
      name.split("/").some((p) => [".git", "node_modules"].includes(p))
    )
      throw invalid();
  }
  const trees = new Map<string, GrCampaignReviewTreeProof["trees"][number]>();
  for (const node of proof.trees) {
    if (
      trees.has(node.oid) ||
      !/^[a-f0-9]{40}$/.test(node.oid) ||
      !Array.isArray(node.entries) ||
      node.entries.length > 4096
    )
      throw invalid();
    const names = new Set<string>(),
      chunks: Buffer[] = [];
    for (const e of node.entries) {
      if (
        !["40000", "100644", "100755", "120000", "160000"].includes(e.mode) ||
        !/^[a-f0-9]{40}$/.test(e.oid) ||
        !/^[A-Za-z0-9_.@+-]+$/.test(e.name) ||
        [".", ".."].includes(e.name) ||
        names.has(e.name)
      )
        throw invalid();
      names.add(e.name);
      chunks.push(Buffer.from(e.mode + " " + e.name + "\0"), Buffer.from(e.oid, "hex"));
    }
    const raw = Buffer.concat(chunks);
    if (createHash("sha1").update(`tree ${raw.length}\0`).update(raw).digest("hex") !== node.oid)
      throw invalid();
    trees.set(node.oid, node);
  }
  const seen = new Set<string>(),
    found = new Map<string, { gitBlob: string; executable: boolean }>();
  let budget = 0;
  const walk = (oid: string, prefix: string, depth: number) => {
    if (depth > 64 || ++budget > 65536) throw invalid();
    const node = trees.get(oid);
    if (!node) throw invalid();
    seen.add(oid);
    for (const entry of node.entries) {
      if (++budget > 65536) throw invalid();
      const name = prefix ? prefix + "/" + entry.name : entry.name;
      const inside = inventory.scope.some((s) => name === s || name.startsWith(s + "/"));
      const ancestor = inventory.scope.some((s) => s.startsWith(name + "/"));
      if (!inside && !ancestor) continue;
      if (entry.mode === "40000") walk(entry.oid, name, depth + 1);
      else {
        if (
          !inside ||
          !["100644", "100755"].includes(entry.mode) ||
          isGrHardPrivatePath(name) ||
          name.split("/").some((p) => [".git", "node_modules"].includes(p))
        )
          throw invalid();
        found.set(name, { gitBlob: entry.oid, executable: entry.mode === "100755" });
        if (found.size > 1024) throw invalid();
      }
    }
  };
  walk(proof.candidateTree, "", 0);
  const expected = new Set<string>();
  for (const file of inventory.files) {
    const actual = found.get(file.path);
    if (
      expected.has(file.path) ||
      !actual ||
      actual.gitBlob !== file.gitBlob ||
      actual.executable !== file.executable
    )
      throw invalid();
    expected.add(file.path);
  }
  if (
    found.size !== expected.size ||
    seen.size !== trees.size ||
    inventory.scope.some((s) => ![...found.keys()].some((p) => p === s || p.startsWith(s + "/")))
  )
    throw invalid();
  return {
    candidateTree: proof.candidateTree,
    files: found.size,
    treeObjects: seen.size,
    scopedCompletenessVerified: true as const,
    authorityGranted: false as const,
  };
}

/** Minimal Merkle closure: complete tree entries for scope ancestors and scoped
 * descendants; out-of-scope siblings contribute only names/modes/object IDs. */
export async function readGrCampaignReviewTreeProof(input: {
  readonly root: string;
  readonly inventory: ReviewTreeInventory;
  readonly grantedEffects?: readonly GrEffectKind[];
}) {
  assertGrEffects(["filesystem.read", "git.read"], input.grantedEffects);
  if (
    !/^[a-f0-9]{40}$/.test(input.inventory.candidateTree) ||
    !input.inventory.scope.length ||
    input.inventory.scope.length > 1024
  )
    throw treeProofInvalid();
  for (const name of input.inventory.scope) {
    assertGrRelativePath(name);
    if (isGrHardPrivatePath(name)) throw treeProofInvalid();
  }
  const trees = new Map<string, GrCampaignReviewTreeProof["trees"][number]>();
  let budget = 0,
    total = 0;
  const visit = async (oid: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 64 || trees.size >= 1024 || ++budget > 65536) throw treeProofInvalid();
    let node = trees.get(oid);
    if (!node) {
      const size = Number(await runRequiredGrGit(input.root, ["cat-file", "-s", oid]));
      total += size;
      if (!Number.isSafeInteger(size) || size < 0 || total > 1024 ** 2) throw treeProofInvalid();
      const raw = await runRequiredGrGit(input.root, ["ls-tree", "-z", oid]);
      const entries = raw
        .split("\0")
        .filter(Boolean)
        .map((line) => {
          const m =
            /^(040000|100644|100755|120000|160000) (tree|blob|commit) ([a-f0-9]{40})\t([A-Za-z0-9_.@+-]+)$/.exec(
              line,
            );
          if (!m) throw treeProofInvalid();
          return { mode: m[1] === "040000" ? "40000" : m[1]!, name: m[4]!, oid: m[3]! };
        });
      node = { oid, entries };
      trees.set(oid, node);
    }
    for (const e of node.entries) {
      if (++budget > 65536) throw treeProofInvalid();
      const name = prefix ? prefix + "/" + e.name : e.name;
      if (
        e.mode === "40000" &&
        input.inventory.scope.some(
          (s) => name === s || name.startsWith(s + "/") || s.startsWith(name + "/"),
        )
      )
        await visit(e.oid, name, depth + 1);
    }
  };
  await visit(input.inventory.candidateTree, "", 0);
  const proof: GrCampaignReviewTreeProof = {
    schema: "gr.campaign-review-tree-proof.v0",
    candidateTree: input.inventory.candidateTree,
    trees: [...trees.values()],
  };
  verifyGrCampaignReviewTreeProof(proof, input.inventory);
  return proof;
}

/** Read frozen scoped blobs, not the mutable checkout. Content export grants no
 * review, protected-custody, Campaign activation or publication authority. */
export async function readGrCampaignReviewSource(input: {
  readonly root: string;
  readonly plan: GrCampaignPlanV0;
  readonly grantedEffects?: readonly GrEffectKind[];
}) {
  assertGrEffects(["filesystem.read", "git.read"], input.grantedEffects);
  const { campaignFingerprint, ...semantic } = input.plan;
  const tree = input.plan.frozen?.candidateTree;
  const invalid = () => new GrError("GR_INVALID_ARTIFACT", "Frozen review source is invalid.");
  if (
    input.plan.schemaVersion !== "gr.campaign-plan.v0" ||
    fingerprintGrJson(semantic, "gr.campaign-plan.v0") !== campaignFingerprint ||
    !tree ||
    tree.algorithm !== "sha1" ||
    tree.kind !== "tree" ||
    !/^[a-f0-9]{40}$/.test(tree.oid) ||
    !input.plan.scope.paths.length
  )
    throw invalid();
  const safe = (value: string) => {
    assertGrRelativePath(value);
    if (
      isGrHardPrivatePath(value) ||
      value
        .split("/")
        .some((p) => !/^[A-Za-z0-9_.@+-]+$/.test(p) || [".git", "node_modules"].includes(p))
    )
      throw invalid();
  };
  input.plan.scope.paths.forEach(safe);
  const before = await inspectGrWorkspace(input.root, {
    grantedEffects: ["filesystem.read", "git.read"],
  });
  if (before.repository.fingerprint !== input.plan.repository.fingerprint) throw invalid();
  const raw = await runRequiredGrGit(input.root, [
    "ls-tree",
    "-r",
    "-z",
    tree.oid,
    "--",
    ...input.plan.scope.paths,
  ]);
  const entries = raw.split("\0").filter(Boolean);
  if (!entries.length || entries.length > 1024) throw invalid();
  const files = [];
  let bytes = 0;
  for (const entry of entries) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
    if (!match) throw invalid();
    const mode = match[1]!,
      gitBlob = match[2]!,
      name = match[3]!;
    safe(name);
    if (!input.plan.scope.paths.some((p) => name === p || name.startsWith(p + "/")))
      throw invalid();
    const size = Number(await runRequiredGrGit(input.root, ["cat-file", "-s", gitBlob]));
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > 2 * 1024 ** 2 ||
      bytes + size > 16 * 1024 ** 2
    )
      throw invalid();
    // The existing GR text backend is deliberately not a binary transport.
    const content = Buffer.from(
      await runRequiredGrGit(input.root, ["cat-file", "blob", gitBlob]),
      "utf8",
    );
    if (
      content.length !== size ||
      createHash("sha1").update(`blob ${size}\0`).update(content).digest("hex") !== gitBlob
    )
      throw invalid();
    bytes += size;
    files.push({
      path: name,
      gitBlob,
      sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      bytes: size,
      executable: mode === "100755",
      contentBase64: content.toString("base64"),
    });
  }
  const after = await inspectGrWorkspace(input.root, {
    grantedEffects: ["filesystem.read", "git.read"],
  });
  if (JSON.stringify(before.head) !== JSON.stringify(after.head)) throw invalid();
  return {
    campaignFingerprint,
    candidateTree: tree.oid,
    scope: input.plan.scope.paths,
    files,
    bytes,
    protectedCustody: false as const,
    authorityGranted: false as const,
  };
}
