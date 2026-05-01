import { getTotalIncludedBytes } from "./collect";
import type {
  PtcPackRunResult,
  PtcRunResult,
  PtcSummaryColors,
  PtcUnpackRunResult,
} from "./types";

export function formatPtcSummary(run: PtcRunResult, colors?: PtcSummaryColors): string {
  if (run.mode === "unpack") {
    return formatPtcUnpackSummary(run, colors);
  }

  return formatPtcPackSummary(run, colors);
}

function formatPtcPackSummary(run: PtcPackRunResult, colors?: PtcSummaryColors): string {
  const { config, result, outputInfo, bytesWritten } = run;
  const lines: string[] = [];
  const c = createSummaryColors(colors);
  const row = (key: string, value: string | number) =>
    `${c.key(key)}: ${c.value(String(value))}`;

  lines.push(row("Mode", config.apply ? c.success("apply") : c.info("summary-only")));
  lines.push(row("Operation", c.value("pack")));
  lines.push(row("Input count", result.inputs.length));
  lines.push(row("Output file", result.outputAbsPath));
  lines.push(row("Overwrite enabled", config.overwrite ? c.warning("yes") : c.info("no")));
  lines.push(row("Included files", c.success(String(result.included.length))));
  lines.push(row("Skipped files", c.warning(String(result.skipped.length))));
  lines.push(row("Total included bytes", getTotalIncludedBytes(result)));

  if (typeof bytesWritten === "number") {
    lines.push(row("Bytes written", bytesWritten));
    lines.push(
      row("Output action", outputInfo.exists ? c.warning("overwritten") : c.success("written")),
    );
  }

  lines.push("");
  lines.push(c.heading("Inputs:"));

  for (const input of result.inputs) {
    const kv = (key: string, value: string) => `${c.key(key)}=${value}`;
    const parts = [
      `  ${c.key(`${input.index + 1}.`)}`,
      kv("path", c.value(input.userPath)),
      kv("type", c.value(input.type)),
      kv("status", input.status === "ok" ? c.success(input.status) : c.error(input.status)),
      kv("included", c.success(String(input.includedCount))),
      kv("skipped", c.warning(String(input.skippedCount))),
    ];

    lines.push(parts.join(" · "));
    lines.push(`     ${kv("resolved", c.value(input.absPath))}`);

    if (input.error) {
      lines.push(`     ${kv("error", c.error(input.error))}`);
    }
  }

  appendStringSection(lines, c.warning("Warnings:"), result.warnings, c.warning);
  appendStringSection(lines, c.heading("Recommendations:"), result.recommendations, c.info);

  if (!config.apply) {
    lines.push("");
    lines.push(
      `${c.info("No output file was written.")} ${c.info("Re-run with --apply to create the context file.")}`,
    );
  }

  return lines.join("\n");
}

function formatPtcUnpackSummary(run: PtcUnpackRunResult, colors?: PtcSummaryColors): string {
  const { config, unpack, bytesWritten } = run;
  const lines: string[] = [];
  const c = createSummaryColors(colors);
  const row = (key: string, value: string | number) =>
    `${c.key(key)}: ${c.value(String(value))}`;
  const skippedFiles = unpack.files.filter((file) => file.skippedReason);
  const writeFiles = unpack.files.filter((file) => file.action === "write" && !file.skippedReason);
  const overwriteFiles = unpack.files.filter(
    (file) => file.action === "overwrite" && !file.skippedReason,
  );

  lines.push(row("Mode", config.apply ? c.success("apply") : c.info("summary-only")));
  lines.push(row("Operation", c.value("unpack")));
  lines.push(row("Input file", unpack.inputAbsPath));
  lines.push(row("Original project root", unpack.packedProjectRoot));
  lines.push(row("Base path", unpack.baseAbsPath));
  lines.push(row("Base provided by", unpack.baseProvidedBy));
  lines.push(row("Overwrite enabled", config.overwrite ? c.warning("yes") : c.info("no")));
  lines.push(row("Packed files", unpack.files.length));
  lines.push(row("Files to write", c.success(String(writeFiles.length))));
  lines.push(row("Files to overwrite", c.warning(String(overwriteFiles.length))));
  lines.push(row("Files skipped", c.warning(String(skippedFiles.length))));

  if (typeof bytesWritten === "number") {
    lines.push(row("Bytes written", bytesWritten));
  }

  lines.push("");
  lines.push(c.heading("Input roots:"));

  for (const root of unpack.inputRoots) {
    lines.push(
      `  ${c.info("-")} ${c.key(root.label)}: ${c.value(root.resolvedPath)} ${c.info(`(${root.type})`)}`,
    );
  }

  if (writeFiles.length > 0) {
    lines.push("");
    lines.push(c.heading("Files to write:"));

    for (const file of writeFiles) {
      lines.push(`${c.success("-")} ${c.success(file.relativeTargetPath)}`);
    }
  }

  if (overwriteFiles.length > 0) {
    lines.push("");
    lines.push(c.warning("Files to overwrite:"));

    for (const file of overwriteFiles) {
      lines.push(`${c.warning("-")} ${c.warning(file.relativeTargetPath)}`);
    }
  }

  if (skippedFiles.length > 0) {
    lines.push("");
    lines.push(c.warning("Skipped files:"));

    for (const file of skippedFiles) {
      lines.push(
        `${c.warning("-")} ${c.value(file.relativeTargetPath)} ${c.warning("-")} ${c.warning(file.skippedReason ?? "skipped")}`,
      );
    }
  }

  appendStringSection(lines, c.warning("Warnings:"), unpack.warnings, c.warning);
  appendStringSection(lines, c.heading("Recommendations:"), unpack.recommendations, c.info);

  if (!config.apply) {
    lines.push("");
    lines.push(
      `${c.info("No files were written.")} ${c.info("Re-run with --apply to unpack the context file.")}`,
    );
  }

  return lines.join("\n");
}

function appendStringSection(
  lines: string[],
  heading: string,
  values: string[],
  format: (text: string) => string,
) {
  if (values.length === 0) {
    return;
  }

  lines.push("");
  lines.push(heading);

  for (const value of values) {
    lines.push(`${format("-")} ${format(value)}`);
  }
}

function createSummaryColors(colors?: PtcSummaryColors): PtcSummaryColors {
  if (colors) {
    return colors;
  }

  const plain = (text: string) => text;

  return {
    heading: plain,
    key: plain,
    value: plain,
    info: plain,
    warning: plain,
    success: plain,
    error: plain,
  };
}