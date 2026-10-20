import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface RemptsParityObservation {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Callers normalize only documented nonsemantic differences before presenting observations. */
export function verifyRemptsParity(
  source: RemptsParityObservation,
  artifact: RemptsParityObservation,
): void {
  for (const key of ["exitCode", "stdout", "stderr"] as const) {
    if (source[key] !== artifact[key]) throw new Error(`RQ_REMPTS_PARITY_DIVERGENCE: ${key}`);
  }
}

export async function verifyRemptsInputClosure(
  hostRoot: string,
  inputs: readonly { kind: "artifact-glue" | "authored-input"; path: string; digest: string }[],
): Promise<void> {
  for (const input of inputs) {
    // Disposable glue is content-bound in the build receipt, not an authored input to reread.
    if (input.kind === "artifact-glue") continue;
    await verifyRemptsArtifactBytes(resolve(hostRoot, input.path), input.digest);
  }
}

export async function verifyRemptsArtifactBytes(
  path: string,
  expectedDigest: string,
): Promise<void> {
  const actual = `sha256:${createHash("sha256")
    .update(await readFile(path))
    .digest("hex")}`;
  if (actual !== expectedDigest) throw new Error(`RQ_REMPTS_ARTIFACT_DRIFT: ${path}`);
}
