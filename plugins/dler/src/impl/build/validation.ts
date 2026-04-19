import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { fileExists, type RequestedTarget, type SkippedTarget } from "../shared-targets";

export interface BuildableTarget extends RequestedTarget {
  readonly manifestPath: string;
  readonly script: string;
}

function hasScript(pkg: Record<string, unknown>, script: string): boolean {
  const scripts = pkg.scripts;
  return Boolean(
    scripts &&
      typeof scripts === "object" &&
      typeof (scripts as Record<string, unknown>)[script] === "string" &&
      ((scripts as Record<string, unknown>)[script] as string).trim().length > 0,
  );
}

export async function resolveBuildableTargets(options: {
  readonly script: string;
  readonly targets: readonly RequestedTarget[];
}): Promise<{ readonly buildable: readonly BuildableTarget[]; readonly skipped: readonly SkippedTarget[] }> {
  const buildable: BuildableTarget[] = [];
  const skipped: SkippedTarget[] = [];

  for (const target of options.targets) {
    const manifestPath = resolve(target.cwd, "package.json");
    if (!(await fileExists(manifestPath))) {
      skipped.push({ label: target.label, reason: "missing package.json" });
      continue;
    }

    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    } catch {
      skipped.push({ label: target.label, reason: "invalid package.json" });
      continue;
    }

    if (!hasScript(pkg, options.script)) {
      skipped.push({ label: target.label, reason: `missing scripts.${options.script}` });
      continue;
    }

    buildable.push({
      cwd: target.cwd,
      label: target.label,
      manifestPath,
      script: options.script,
    });
  }

  return { buildable, skipped };
}
