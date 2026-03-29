import type { BuildReport } from "@reliverse/builder-rse-plugin/build-runtime";

export async function runPrebuildForPackage(packageRoot: string, label: string): Promise<BuildReport> {
  const { createBuilderRuntime, createBunBuildProvider } = await import(
    "@reliverse/builder-rse-plugin/build-runtime"
  );
  const runtime = createBuilderRuntime({ providers: [createBunBuildProvider()] });
  return runtime.run({
    provider: "bun",
    targets: [{ cwd: packageRoot, label }],
  });
}
