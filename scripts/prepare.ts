#!/usr/bin/env bun

import { mkdir, rm, writeFile } from "node:fs/promises";

type Cli = {
  deployRuntime: boolean;
  dev: boolean;
  dryRun: boolean;
  force: boolean;
  help: boolean;
};

function printHelp(): void {
  const bin = process.argv[1] ?? "scripts/prepare.ts";
  console.log(`Usage: bun ${bin} [options]

Prepare the current repository folder for a specific environment.
No interactive prompts; behavior is controlled by flags only.

Options:
  --deploy-runtime, --deploy   Generate deploy-runtime guardrails in the current folder
  --dev                        Prepare current folder for development mode
  --dry-run, -d                Print actions without writing files
  --force, -f                  Overwrite files even if they already exist
  --help, -h                   Show this help message

Examples:
  bun scripts/prepare.ts --deploy-runtime
  bun scripts/prepare.ts --dev
  bun scripts/prepare.ts --deploy --force
`);
}

function parseArgs(argv: string[]): Cli {
  let deployRuntime = false;
  let dev = false;
  let dryRun = false;
  let force = false;
  let help = false;

  for (const a of argv) {
    if (a === "--deploy-runtime" || a === "--deploy") deployRuntime = true;
    else if (a === "--dev") dev = true;
    else if (a === "--dry-run" || a === "-d") dryRun = true;
    else if (a === "--force" || a === "-f") force = true;
    else if (a === "--help" || a === "-h") help = true;
    else {
      console.error(`Unknown option: ${a}`);
      console.error("Use --help for usage information");
      process.exit(2);
    }
  }

  return { deployRuntime, dev, dryRun, force, help };
}

async function writeFileSafe(path: string, content: string, opts: { dryRun: boolean; force: boolean }): Promise<void> {
  if (opts.dryRun) {
    console.log(`[dry-run] write ${path}`);
    return;
  }

  const mode = opts.force ? undefined : "wx";
  await writeFile(path, content, mode ? ({ flag: mode } as const) : undefined);
  console.log(`wrote ${path}`);
}

async function removePathSafe(path: string, opts: { dryRun: boolean }): Promise<void> {
  if (opts.dryRun) {
    console.log(`[dry-run] remove ${path}`);
    return;
  }
  await rm(path, { force: true, recursive: true });
  console.log(`removed ${path}`);
}

async function prepareDeployRuntime(opts: { dryRun: boolean; force: boolean }): Promise<void> {
  const marker = `# Deploy checkout (runtime)\n\nThis repo is used as a deploy/runtime checkout.\n\nDo not commit/push from here.\nUse: \`~/dev/reliverse/reliverse\` for development work.\n`;

  const preCommit = `#!/usr/bin/env bash\necho "❌ Commit blocked: this is a deploy/runtime checkout."\necho "Use dev repo instead: ~/dev/reliverse/reliverse"\nexit 1\n`;

  const prePush = `#!/usr/bin/env bash\necho "❌ Push blocked from deploy/runtime checkout."\necho "Use dev repo instead: ~/dev/reliverse/reliverse"\nexit 1\n`;

  if (!opts.dryRun) {
    await mkdir(".githooks", { recursive: true });
  }

  await writeFileSafe("DO_NOT_COMMIT_HERE.md", marker, opts);
  await writeFileSafe(".githooks/pre-commit", preCommit, opts);
  await writeFileSafe(".githooks/pre-push", prePush, opts);

  if (!opts.dryRun) {
    await Bun.$`chmod +x .githooks/pre-commit .githooks/pre-push`;
    await Bun.$`git config core.hooksPath .githooks`;
    await Bun.$`git config pull.ff only`;
    await Bun.$`git config fetch.prune true`;
  }

  console.log("deploy-runtime guardrails prepared");
}

async function prepareDev(opts: { dryRun: boolean }): Promise<void> {
  await removePathSafe("DO_NOT_COMMIT_HERE.md", opts);
  await removePathSafe(".githooks/pre-commit", opts);
  await removePathSafe(".githooks/pre-push", opts);

  if (!opts.dryRun) {
    // Unset hooksPath if it points to local deploy hooks.
    let hooksPath = "";
    try {
      hooksPath = (await Bun.$`git config --get core.hooksPath`.quiet()).text().trim();
    } catch {
      hooksPath = "";
    }
    if (hooksPath === ".githooks") {
      await Bun.$`git config --unset core.hooksPath`;
      console.log("unset git core.hooksPath (.githooks)");
    }

    await Bun.$`git config pull.ff only`;
    await Bun.$`git config fetch.prune true`;
  }

  console.log("development mode prepared");
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  if (cli.help) {
    printHelp();
    process.exit(0);
  }

  if (Number(cli.deployRuntime) + Number(cli.dev) !== 1) {
    console.error("Select exactly one environment: --deploy-runtime (or --deploy) OR --dev");
    process.exit(2);
  }

  try {
    if (cli.deployRuntime) {
      await prepareDeployRuntime({ dryRun: cli.dryRun, force: cli.force });
    } else {
      await prepareDev({ dryRun: cli.dryRun });
    }
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST") {
      console.error("Some files already exist. Re-run with --force to overwrite.");
      process.exit(1);
    }
    console.error(error);
    process.exit(1);
  }
}

await main();
