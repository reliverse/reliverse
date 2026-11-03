import { inspectGrWorkspace } from "../../packages/gr-core/src/inspect";

if (process.argv.length > 3) {
  console.error("Usage: bun examples/gr/inspect.ts [repository-root]");
  process.exit(2);
}

try {
  const result = await inspectGrWorkspace(process.argv[2] ?? process.cwd(), {
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const { summary } = result;
  console.log("GR source inspection (read-only)");
  console.log(`HEAD: ${result.head.state}`);
  console.log(`Workspace: ${summary.dirty ? "dirty" : "clean"}`);
  console.log(`Changes: ${summary.staged} staged, ${summary.unstaged} unstaged, ${summary.untracked} untracked, ${summary.conflicted} conflicted`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
