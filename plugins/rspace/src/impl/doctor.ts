import { access } from "node:fs/promises";
import path from "node:path";

import { runProcessCheck } from "./archive";
import { getCurrentDirectory, logInfo } from "./context";
import type { RspaceToolCheck } from "./types";

export async function runRspaceDoctorCommand(ctx: unknown): Promise<string> {
  const cwd = getCurrentDirectory(ctx);
  const checks: RspaceToolCheck[] = [
    checkProcess("tar", ["tar", "--version"]),
    checkProcess("sha256sum", ["sha256sum", "--version"]),
    await checkDirectory("cwd", cwd),
    await checkDirectory("home", process.env.HOME),
    await checkDirectory("/mnt/data", "/mnt/data", { optional: true }),
  ];

  const report = formatDoctorReport(checks);
  logInfo(ctx, report);

  return report;
}

function checkProcess(name: string, command: string[]): RspaceToolCheck {
  const result = runProcessCheck(command);
  const firstLine = result.output.split("\n").find(Boolean);

  return {
    name,
    ok: result.ok,
    detail: firstLine ?? (result.ok ? "available" : "not available"),
  };
}

async function checkDirectory(
  name: string,
  directoryPath?: string,
  options: { optional?: boolean } = {},
): Promise<RspaceToolCheck> {
  if (!directoryPath) {
    return {
      name,
      ok: Boolean(options.optional),
      detail: options.optional ? "not configured" : "missing path",
    };
  }

  try {
    await access(directoryPath);

    return {
      name,
      ok: true,
      detail: path.resolve(directoryPath),
    };
  } catch {
    return {
      name,
      ok: Boolean(options.optional),
      detail: options.optional ? `optional path not found: ${directoryPath}` : `path not found: ${directoryPath}`,
    };
  }
}

function formatDoctorReport(checks: RspaceToolCheck[]): string {
  const requiredFailed = checks.some((check) => !check.ok && check.name !== "/mnt/data");
  const lines = [requiredFailed ? "Rspace doctor found issues" : "Rspace doctor passed", ""];

  for (const check of checks) {
    lines.push(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }

  return lines.join("\n");
}
