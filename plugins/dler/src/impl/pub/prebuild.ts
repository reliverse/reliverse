import type { BuildReport } from "@reliverse/dler-rse-plugin/build-runtime";

export async function runPrebuildForPackage(packageRoot: string, label: string): Promise<BuildReport> {
  const { createBuilderRuntime, createBunBuildProvider, createGeneratedBuildCommand } = await import(
    "@reliverse/dler-rse-plugin/build-runtime"
  );
  const runtime = createBuilderRuntime({ providers: [createBunBuildProvider()] });
  const command = createGeneratedBuildCommand({ cwd: packageRoot, label });
  return runtime.run({
    provider: "bun",
    targets: [{ command: command.argv, cwd: packageRoot, displayCommand: command.display, label }],
  });
}
