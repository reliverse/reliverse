import path from "node:path";

import { createTarGzArchive } from "./archive";
import { logInfo, readPackOptions } from "./context";
import { assertDirectory, pathExists } from "./files";
import { normalizeArchivePath } from "./paths";
import { RSPACE_STATE_PATH } from "./constants";

export async function runRspacePackCommand(ctx: unknown): Promise<string> {
  const options = readPackOptions(ctx);
  const archivePath = normalizeArchivePath(options.output);

  await assertDirectory(options.input, "Rspace input");
  await assertExistingRspaceRoot(options.input);

  if (!options.apply) {
    const preview = [
      "Rspace pack preview",
      "",
      `Input: ${options.input}`,
      `Output: ${archivePath}`,
      `Overwrite: ${options.overwrite ? "yes" : "no"}`,
      "",
      "No archive was written. Pass --apply to create it.",
    ].join("\n");

    logInfo(ctx, preview);
    return preview;
  }

  await createTarGzArchive({
    workspacePath: options.input,
    archivePath,
    overwrite: options.overwrite,
  });

  const message = `Created Rspace archive: ${archivePath}`;
  logInfo(ctx, message);

  return message;
}

async function assertExistingRspaceRoot(inputPath: string): Promise<void> {
  const statePath = path.join(inputPath, RSPACE_STATE_PATH);
  const exists = await pathExists(statePath);

  if (!exists) {
    throw new Error(`Input is not an Rspace root. Missing ${RSPACE_STATE_PATH} in ${inputPath}.`);
  }
}
