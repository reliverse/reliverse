import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";

import { collectFiles, getTotalIncludedBytes, hasFailedInputs } from "./collect";
import { PACKED_BLOCK_SEPARATOR } from "./constants";
import type {
  CliConfig,
  CollectedFile,
  CollectResult,
  OutputInfo,
  OutputWriter,
  PtcPackRunResult,
} from "./types";
import { isNodeError } from "./utils/errors";
import { isSamePath, normalizePathForDisplay } from "./utils/path";
import { getUtf8ByteLength, readTextFile } from "./utils/text";

export async function runPtcPack(config: CliConfig): Promise<PtcPackRunResult> {
  const result = await collectFiles(config);
  const outputInfo = await inspectOutputPath(result);

  addOutputWarnings(config, result, outputInfo);

  if (!config.apply) {
    return { mode: "pack", config, result, outputInfo };
  }

  assertCanApplyPack(config, result, outputInfo);

  await prepareOutputFile(result.outputAbsPath);

  const writer = createOutputWriter(result.outputAbsPath);
  let writeFailed = false;

  try {
    await writeOutput(writer, config, result, outputInfo);
  } catch (error) {
    writeFailed = true;
    throw error;
  } finally {
    try {
      await writer.end();
    } catch (error) {
      if (!writeFailed) {
        throw error;
      }
    }
  }

  return {
    mode: "pack",
    config,
    result,
    outputInfo,
    bytesWritten: writer.bytesWritten(),
  };
}

async function inspectOutputPath(result: CollectResult): Promise<OutputInfo> {
  for (const input of result.inputs) {
    if (input.type === "file" && isSamePath(input.absPath, result.outputAbsPath)) {
      throw new Error(`Output file must be different from input file: ${result.outputAbsPath}`);
    }
  }

  try {
    const outputStats = await lstat(result.outputAbsPath);

    if (outputStats.isDirectory()) {
      throw new Error(`Output path is a directory, expected a file path: ${result.outputAbsPath}`);
    }

    return {
      exists: true,
      isFile: outputStats.isFile(),
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        exists: false,
        isFile: false,
      };
    }

    throw error;
  }
}

function addOutputWarnings(config: CliConfig, result: CollectResult, outputInfo: OutputInfo) {
  if (!outputInfo.exists) {
    return;
  }

  if (config.overwrite) {
    result.warnings.push(
      `Output file already exists and will be overwritten because --overwrite is enabled: ${result.outputAbsPath}`,
    );
    return;
  }

  if (config.apply) {
    result.warnings.push(
      `Output file already exists and apply will fail without --overwrite: ${result.outputAbsPath}`,
    );
    return;
  }

  result.warnings.push(
    `Output file already exists: ${result.outputAbsPath}. Pass --overwrite with --apply to replace it.`,
  );
}

function assertCanApplyPack(config: CliConfig, result: CollectResult, outputInfo: OutputInfo) {
  if (hasFailedInputs(result)) {
    throw new Error("Apply aborted because one or more input paths failed.");
  }

  if (outputInfo.exists && !config.overwrite) {
    throw new Error(
      `Output file already exists: ${result.outputAbsPath}. Pass --overwrite to replace it.`,
    );
  }
}

async function prepareOutputFile(outputPath: string) {
  await mkdir(path.dirname(outputPath), { recursive: true });
}

function createOutputWriter(outputPath: string): OutputWriter {
  const sink = Bun.file(outputPath).writer();
  const encoder = new TextEncoder();
  let writtenBytes = 0;

  return {
    async write(chunk: string) {
      const writeResult = await sink.write(chunk);

      writtenBytes +=
        typeof writeResult === "number" && Number.isFinite(writeResult)
          ? writeResult
          : encoder.encode(chunk).byteLength;
    },
    async end() {
      await sink.end();
    },
    bytesWritten() {
      return writtenBytes;
    },
  };
}

async function writeOutput(
  writer: OutputWriter,
  config: CliConfig,
  result: CollectResult,
  outputInfo: OutputInfo,
) {
  await writeSummary(writer, config, result, outputInfo);
  await writer.write("\n## Content\n");

  for (const file of result.included) {
    const content = await readTextFile(file.absPath);
    await writeFileBlock(writer, file, content);
  }
}

async function writeSummary(
  writer: OutputWriter,
  config: CliConfig,
  result: CollectResult,
  outputInfo: OutputInfo,
) {
  const totalIncludedBytes = getTotalIncludedBytes(result);

  await writer.write("# Packed Text Context\n\n");
  await writer.write("## Summary\n\n");
  await writer.write("- Mode: apply\n");
  await writer.write(`- Project root: ${normalizePathForDisplay(process.cwd())}\n`);
  await writer.write(`- Output file: ${normalizePathForDisplay(result.outputAbsPath)}\n`);
  await writer.write(`- Output action: ${outputInfo.exists ? "overwritten" : "written"}\n`);
  await writer.write(`- Generated timestamp: ${new Date().toISOString()}\n`);
  await writer.write(`- Input count: ${result.inputs.length}\n`);
  await writer.write(`- Included files: ${result.included.length}\n`);
  await writer.write(`- Skipped files: ${result.skipped.length}\n`);
  await writer.write(`- Total included bytes: ${totalIncludedBytes}\n`);
  await writer.write(
    `- Max file size: ${Number.isFinite(config.maxSizeBytes) ? `${config.maxSizeBytes} bytes` : "unlimited"}\n`,
  );
  await writer.write(`- Hidden files included: ${config.includeHidden ? "yes" : "no"}\n`);
  await writer.write(`- Extension mode: ${config.extMode}\n\n`);

  await writer.write("## Inputs\n\n");

  for (const input of result.inputs) {
    await writer.write(`- Input ${input.index + 1}: ${input.userPath}\n`);
    await writer.write(`  - Label: ${input.label}\n`);
    await writer.write(`  - Resolved: ${normalizePathForDisplay(input.absPath)}\n`);
    await writer.write(`  - Type: ${input.type}\n`);
    await writer.write(`  - Status: ${input.status}\n`);
    await writer.write(`  - Included files: ${input.includedCount}\n`);
    await writer.write(`  - Skipped files: ${input.skippedCount}\n`);

    if (input.error) {
      await writer.write(`  - Error: ${input.error}\n`);
    }
  }

  await writer.write("\n## Warnings\n\n");
  await writeStringList(writer, result.warnings);

  await writer.write("\n## Recommendations\n\n");
  await writeStringList(writer, result.recommendations);

  await writer.write("\n## Included Files\n\n");

  if (result.included.length === 0) {
    await writer.write("- None\n");
  } else {
    for (const file of result.included) {
      await writer.write(
        `- ${file.displayPath} (${file.sizeBytes} bytes, input: ${file.inputLabel})\n`,
      );
    }
  }

  await writer.write("\n## Skipped Files\n\n");

  if (result.skipped.length === 0) {
    await writer.write("- None\n");
  } else {
    for (const skipped of result.skipped) {
      await writer.write(
        `- ${skipped.displayPath} — ${skipped.reason} (input: ${skipped.inputLabel})\n`,
      );
    }
  }
}

async function writeStringList(writer: OutputWriter, values: string[]) {
  if (values.length === 0) {
    await writer.write("- None\n");
    return;
  }

  for (const value of values) {
    await writer.write(`- ${value}\n`);
  }
}

async function writeFileBlock(writer: OutputWriter, file: CollectedFile, content: string) {
  await writer.write(`\n${PACKED_BLOCK_SEPARATOR}\n`);
  await writer.write(`FILE: ${file.relPath}\n`);
  await writer.write(`INPUT: ${file.inputLabel}\n`);
  await writer.write(`SIZE: ${getUtf8ByteLength(content)} bytes\n`);
  await writer.write(`${PACKED_BLOCK_SEPARATOR}\n`);
  await writer.write(content);

  if (!content.endsWith("\n")) {
    await writer.write("\n");
  }
}