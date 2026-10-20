import { randomUUID } from "node:crypto";
import { link, mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";

import { GrError } from "./error";

function errnoCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export async function publishGrArtifactAtomically<T>(options: {
  readonly output: string;
  readonly writeTemporary: (temporaryOutput: string) => Promise<T>;
}): Promise<Readonly<{ output: string; value: T }>> {
  const output = path.resolve(options.output);
  const parent = path.dirname(output);

  await mkdir(parent, { recursive: true });

  if (await Bun.file(output).exists()) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR artifact output already exists; refusing to overwrite.",
      { output },
    );
  }

  const temporaryOutput = path.join(
    parent,
    `.${path.basename(output)}.partial-${process.pid}-${randomUUID()}`,
  );

  try {
    const value = await options.writeTemporary(temporaryOutput);

    const info = await stat(temporaryOutput);
    if (!info.isFile()) {
      throw new GrError(
        "GR_INVALID_ARTIFACT",
        "GR atomic publication temporary artifact is not a regular file.",
        { output, temporaryOutput },
      );
    }

    const handle = await open(temporaryOutput, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await link(temporaryOutput, output);
    } catch (error) {
      if (errnoCode(error) === "EEXIST") {
        throw new GrError(
          "GR_INVALID_ARTIFACT",
          "GR artifact output became occupied during atomic publication; refusing to overwrite.",
          { output },
        );
      }

      throw error;
    }

    return Object.freeze({ output, value });
  } finally {
    await rm(temporaryOutput, { force: true }).catch(() => undefined);
  }
}
