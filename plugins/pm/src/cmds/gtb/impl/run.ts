import { mkdir } from "node:fs/promises";

import { npmPack } from "./npm";
import { buildGtbPlan } from "./plan";
import type { GtbOptions, GtbRunResult } from "./types";
import { fileExists } from "./utils";

export async function runGtb(options: GtbOptions): Promise<GtbRunResult> {
  const { requestedSpec, resolvedRoot, plan, skipped } = await buildGtbPlan(options);
  const commands = plan.map(
    (item) =>
      `${options.npmBin} pack ${item.resolvedSpec} --pack-destination ${shellArg(options.outputDir)} --json`,
  );

  if (!options.overwrite) {
    const existing = [];

    for (const item of plan) {
      if (await fileExists(item.outputPath)) {
        existing.push(item.outputPath);
      }
    }

    if (existing.length > 0) {
      throw new Error(
        [
          "One or more target tarballs already exists.",
          "Pass --overwrite to allow replacing them.",
          "",
          ...existing.map((path) => `- ${path}`),
        ].join("\n"),
      );
    }
  }

  const result: GtbRunResult = {
    ok: true,
    apply: options.apply,
    packageName: options.packageName,
    inputPackageName: options.inputPackageName,
    requestedSpec,
    resolvedRoot,
    os: options.os,
    arch: options.arch,
    outputDir: options.outputDir,
    optionalMode: options.optionalMode,
    aliased: options.aliased,
    ...(options.alias ? { alias: options.alias } : {}),
    plan,
    packed: [],
    skipped,
    commands,
  };

  if (!options.apply) {
    return result;
  }

  await mkdir(options.outputDir, { recursive: true });

  for (const item of plan) {
    const npm = await npmPack(options.npmBin, item.resolvedSpec, options.outputDir);

    result.packed.push({
      plan: item,
      npm,
    });
  }

  return result;
}

function shellArg(value: string): string {
  if (/^[a-zA-Z0-9_./:@+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}
