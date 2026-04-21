import { pathToFileURL } from "node:url";

import { resolvePackageBuildCommand } from "./package-build-command";

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

const cwd = readFlag("--cwd");
const label = readFlag("--label") ?? cwd;

if (!cwd) {
  console.error("Missing required flag: --cwd");
  process.exit(1);
}

const command = await resolvePackageBuildCommand({ cwd, label: label ?? cwd });
if (!command) {
  console.error(`No generated build command matched ${label ?? cwd}.`);
  process.exit(1);
}

const processHandle = Bun.spawn([...command.argv], {
  cwd,
  stderr: "inherit",
  stdout: "inherit",
});

const exitCode = await processHandle.exited;
process.exit(exitCode);
