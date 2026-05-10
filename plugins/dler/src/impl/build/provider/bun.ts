import { rm } from "node:fs/promises";
import { join } from "node:path";

import { DLER_BUILD_DEFAULTS } from "../../constants";
import { formatDeclarDiagnostics, runDeclarDeclarationLayer } from "../declaration-layer";
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

      if (target.runDeclarations) {
        await rm(join(target.cwd, "dist"), { force: true, recursive: true });
      }

      const processHandle = Bun.spawn([...target.command], {
        cwd: target.cwd,
        stderr: "pipe",
        stdout: "pipe",
      });
      const [commandStdout, stderr, exitCode] = await Promise.all([
        readProcessStream(processHandle.stdout),
        readProcessStream(processHandle.stderr),
        processHandle.exited,
      ]);
      const stdoutLines = [commandStdout];

      if (exitCode === 0 && target.runDeclarations) {
        const declarationResult = await runDeclarDeclarationLayer(
          { cwd: target.cwd, label },
          { declarationStrategy: target.declarationStrategy },
        );

        if (declarationResult.skippedReason) {
          stdoutLines.push(`Declar declarations skipped: ${declarationResult.skippedReason}.\n`);
        } else {
          if (declarationResult.diagnostics.length > 0) {
            stdoutLines.push(`${formatDeclarDiagnostics(declarationResult.diagnostics)}\n`);
          }

          stdoutLines.push(
            declarationResult.ok
              ? `Declar declarations emitted: ${declarationResult.emittedFiles.length} file(s).\n`
              : "Declar declaration generation failed.\n",
          );

          if (!declarationResult.ok) {
            const durationMs = Math.round(performance.now() - startedAt);

            return {
              cwd: target.cwd,
              durationMs,
              exitCode: 1,
              label,
              ok: false,
              provider: DLER_BUILD_DEFAULTS.provider,
              stderr,
              stdout: stdoutLines.join(""),
            };
          }
        }
      }

      const durationMs = Math.round(performance.now() - startedAt);

      return {
        cwd: target.cwd,
        durationMs,
        exitCode,
        label,
        ok: exitCode === 0,
        provider: DLER_BUILD_DEFAULTS.provider,
        stderr,
        stdout: stdoutLines.join(""),
      };
    },
    id: DLER_BUILD_DEFAULTS.provider,
  };
}
