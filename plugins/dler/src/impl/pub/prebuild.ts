import type { BuildReport } from "@reliverse/dler-rse-plugin/build-runtime";

export async function createPrebuildPlanForPackage(packageRoot: string, label: string) {
  const { createBuildPlan } = await import(
    "@reliverse/dler-rse-plugin/build-runtime"
  );
  return createBuildPlan({
    provider: "bun",
    targets: [{ cwd: packageRoot, label }],
  });
}

export async function runPrebuildForPackage(packageRoot: string, label: string): Promise<BuildReport> {
  const { createBuilderRuntime, createBunBuildProvider } = await import(
    "@reliverse/dler-rse-plugin/build-runtime"
  );
  const runtime = createBuilderRuntime({ providers: [createBunBuildProvider()] });
  const plan = await createPrebuildPlanForPackage(packageRoot, label);

  return runtime.run({
    provider: plan.provider,
    targets: plan.executionTargets,
  });
}
