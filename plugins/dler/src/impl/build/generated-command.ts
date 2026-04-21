import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { RequestedTarget } from "../shared-targets";

export interface BuildCommandInvocation {
  readonly argv: readonly string[];
  readonly display: string;
}

const INTERNAL_RUNNER_ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "internal-runner.ts");

export function createGeneratedBuildCommand(target: RequestedTarget): BuildCommandInvocation {

  return {
    argv: ["bun", INTERNAL_RUNNER_ENTRY, "--cwd", target.cwd, "--label", target.label],
    display: `bun ${INTERNAL_RUNNER_ENTRY} --cwd ${target.cwd} --label ${target.label}`,
  };
}
