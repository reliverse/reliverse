import type { BuildProvider, BuildTarget, BuildTargetResult } from "./types";

async function readProcessStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return "";
  }

  return new Response(stream).text();
}

export function createBunBuildProvider(): BuildProvider {
  return {
    async buildTarget(target: BuildTarget): Promise<BuildTargetResult> {
      const startedAt = performance.now();
      const label = target.label ?? target.cwd;
      const processHandle = Bun.spawn([...target.command], {
        cwd: target.cwd,
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        readProcessStream(processHandle.stdout),
        readProcessStream(processHandle.stderr),
        processHandle.exited,
      ]);
      const durationMs = Math.round(performance.now() - startedAt);

      return {
        cwd: target.cwd,
        durationMs,
        exitCode,
        label,
        ok: exitCode === 0,
        provider: "bun",
        stderr,
        stdout,
      };
    },
    id: "bun",
  };
}
