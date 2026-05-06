import { formatDeclarDiagnostics, runDeclarDeclarationLayer } from "./declaration-layer";
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

if (exitCode !== 0) {
  process.exit(exitCode);
}

const declarationResult = await runDeclarDeclarationLayer({ cwd, label: label ?? cwd });

if (declarationResult.skippedReason) {
  console.log(`Declar declarations skipped: ${declarationResult.skippedReason}.`);
  process.exit(0);
}

if (declarationResult.diagnostics.length > 0) {
  console.log(formatDeclarDiagnostics(declarationResult.diagnostics));
}

if (!declarationResult.ok) {
  process.exit(1);
}

console.log(`Declar declarations emitted: ${declarationResult.emittedFiles.length} file(s).`);
process.exit(0);
