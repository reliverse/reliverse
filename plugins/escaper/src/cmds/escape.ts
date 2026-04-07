import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

import { defineCommand } from "@reliverse/rempts";
import pMap from "p-map";

interface FileMapping {
  format: string;
  patterns: string[];
}

interface EscapeAction {
  readonly action: "blocked" | "noop" | "planned" | "written";
  readonly kind: "convert" | "unescape";
  readonly inputPath: string;
  readonly outputPath: string;
  readonly reason?: string | undefined;
}

function escapeContent(content: string): string {
  return content.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\${/g, "\\${");
}

function unescapeContent(content: string): string {
  return content.replace(/\\\${/g, "${").replace(/\\`/g, "`").replace(/\\\\/g, "\\");
}

function extractContentFromTs(tsContent: string): string {
  const prefix = "export const content = `";
  const prefixIndex = tsContent.indexOf(prefix);

  if (prefixIndex === -1) {
    throw new Error("Invalid escaped file format: expected 'export const content = `...`;'");
  }

  const contentStart = prefixIndex + prefix.length;
  let contentEnd = tsContent.length;

  for (let i = contentEnd - 1; i >= contentStart; i--) {
    if (tsContent[i] === "`") {
      const beforeBacktick = tsContent[i - 1];

      if (beforeBacktick !== "\\") {
        contentEnd = i;
        break;
      }

      let backslashCount = 0;

      for (let j = i - 1; j >= contentStart && tsContent[j] === "\\"; j--) {
        backslashCount++;
      }

      if (backslashCount % 2 === 0) {
        contentEnd = i;
        break;
      }
    }
  }

  if (contentEnd === tsContent.length) {
    throw new Error("Invalid escaped file format: could not find closing backtick");
  }

  return tsContent.slice(contentStart, contentEnd);
}

function parseMap(mapString: string): FileMapping[] {
  const mappings: FileMapping[] = [];
  const parts = mapString.trim().split(/\s+/);

  for (const part of parts) {
    const [format, files] = part.split(":", 2);

    if (!format || !files) {
      continue;
    }

    const patterns = files
      .split(",")
      .map((pattern) => pattern.trim())
      .filter(Boolean);

    mappings.push({ format, patterns });
  }

  return mappings;
}

async function findFiles(
  inputPath: string,
  mappings: FileMapping[] | null,
  recursive: boolean,
): Promise<string[]> {
  const files: string[] = [];
  const inputStat = await stat(inputPath);

  if (inputStat.isFile()) {
    return [inputPath];
  }

  if (!inputStat.isDirectory()) {
    throw new Error(`Input path is neither a file nor a directory: ${inputPath}`);
  }

  const defaultExtensions = [".md", ".mdc", ".mdx", ".json", ".jsonc", ".toml"];

  async function walkDir(dir: string, baseDir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (recursive) {
          await walkDir(fullPath, baseDir);
        }

        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      let shouldInclude = false;
      const ext = extname(entry.name);

      if (defaultExtensions.includes(ext)) {
        shouldInclude = true;
      }

      if (mappings) {
        for (const mapping of mappings) {
          for (const pattern of mapping.patterns) {
            if (pattern === "*") {
              const expectedExt = mapping.format.startsWith(".")
                ? mapping.format
                : `.${mapping.format}`;

              if (ext === expectedExt) {
                shouldInclude = true;
                break;
              }
            } else if (pattern.startsWith("*.")) {
              const patternExt = pattern.slice(1);
              const expectedExt = patternExt.startsWith(".") ? patternExt : `.${patternExt}`;

              if (ext === expectedExt) {
                shouldInclude = true;
                break;
              }
            } else {
              const patternPath = join(baseDir, pattern);
              const normalizedPattern = resolve(patternPath);
              const normalizedFull = resolve(fullPath);

              if (normalizedFull === normalizedPattern) {
                shouldInclude = true;
                break;
              }
            }
          }

          if (shouldInclude) {
            break;
          }
        }
      }

      if (shouldInclude) {
        files.push(fullPath);
      }
    }
  }

  await walkDir(inputPath, inputPath);

  return files;
}

function isDeclarationFile(filename: string): boolean {
  return filename.endsWith(".d.ts") || filename.endsWith(".d.mts") || filename.endsWith(".d.cts");
}

async function findEscapedFiles(inputPath: string, recursive: boolean): Promise<string[]> {
  const files: string[] = [];
  const inputStat = await stat(inputPath);

  if (inputStat.isFile()) {
    const ext = extname(inputPath);
    const fileName = basename(inputPath);

    if ((ext === ".ts" || ext === ".js") && !isDeclarationFile(fileName)) {
      return [inputPath];
    }

    return [];
  }

  if (!inputStat.isDirectory()) {
    throw new Error(`Input path is neither a file nor a directory: ${inputPath}`);
  }

  async function walkDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (recursive) {
          await walkDir(fullPath);
        }

        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = extname(entry.name);

      if ((ext === ".ts" || ext === ".js") && !isDeclarationFile(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  await walkDir(inputPath);

  return files;
}

function getOutputPath(inputPath: string, filePath: string, isDirectory: boolean): string {
  if (isDirectory) {
    const inputDir = dirname(inputPath);
    const inputName = basename(inputPath);
    const outputDir = join(inputDir, `${inputName}-escaped`);
    const relPath = relative(inputPath, filePath);
    const outputFile = join(outputDir, relPath);

    return `${outputFile}.ts`;
  }

  return `${inputPath}.ts`;
}

function getUnescapeOutputPath(
  inputPath: string,
  filePath: string,
  isDirectory: boolean,
): string {
  if (isDirectory) {
    const inputName = basename(inputPath);
    const inputDir = dirname(inputPath);
    const outputDirName = inputName.endsWith("-escaped")
      ? `${inputName.slice(0, -8)}-unescaped`
      : `${inputName}-unescaped`;
    const outputDir = join(inputDir, outputDirName);
    const relPath = relative(inputPath, filePath);
    const outputFile = join(outputDir, relPath);
    const ext = extname(outputFile);

    if (ext === ".ts" || ext === ".js") {
      return outputFile.slice(0, -ext.length);
    }

    return outputFile;
  }

  const ext = extname(inputPath);
  const outputName =
    ext === ".ts" || ext === ".js" ? basename(inputPath, ext) : basename(inputPath, ".ts");

  return join(dirname(inputPath), outputName);
}

function createEscapedModuleContent(content: string): string {
  const escaped = escapeContent(content);
  return `export const content = \`${escaped}\`;\n`;
}

async function buildConvertedFileContent(inputPath: string): Promise<string> {
  const content = await readFile(inputPath, "utf-8");
  return createEscapedModuleContent(content);
}

async function buildUnconvertedFileContent(inputPath: string): Promise<string> {
  const tsContent = await readFile(inputPath, "utf-8");
  const escapedContent = extractContentFromTs(tsContent);
  return unescapeContent(escapedContent);
}

async function readOptionalTextFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function writeOutputFile(outputPath: string, content: string): Promise<void> {
  const outputDir = dirname(outputPath);
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, content, "utf-8");
}

function buildActionSummary(actions: readonly EscapeAction[]) {
  const blocked = actions.filter((action) => action.action === "blocked").length;
  const noop = actions.filter((action) => action.action === "noop").length;
  const planned = actions.filter((action) => action.action === "planned").length;
  const written = actions.filter((action) => action.action === "written").length;

  return {
    actions,
    blocked,
    noop,
    planned,
    total: actions.length,
    written,
  };
}

export default defineCommand({
  meta: {
    name: "escape",
    description:
      "Convert files (.md, .mdc, .mdx, .json, .jsonc, .toml) to TypeScript with proper escaping",
  },
  agent: {
    notes:
      "This command is idempotent by default. Re-runs produce no-op results when outputs are already up to date, and differing existing outputs fail fast unless --force is supplied.",
  },
  conventions: {
    idempotent: true,
    supportsDryRun: true,
    supportsForce: true,
  },
  help: {
    examples: [
      'rse escape --input "path/to/file.md"',
      'rse escape --input "path/to/dir" --dry-run',
      'rse escape --input "path/to/dir" --force',
      'rse escape --input "path/to/dir" --map "md:.rules,path/to/file json:*.markdown"',
      'rse escape --input "path/to/dir-escaped" --unescape',
      'rse escape --input "path/to/dir" --json',
    ],
    text: "Input resolution is explicit: provide --input, optionally preview with --dry-run, and use --force only when overwriting differing outputs is intentional.",
  },
  options: {
    dryRun: {
      type: "boolean",
      description: "Preview writes without modifying files",
      inputSources: ["flag"],
    },
    force: {
      type: "boolean",
      description: "Overwrite existing output files when the generated content differs",
      inputSources: ["flag"],
    },
    input: {
      type: "string",
      required: true,
      description: "Path to file or directory to process",
      hint: "Pass an explicit path. This command does not infer targets from stdin.",
      inputSources: ["flag"],
    },
    map: {
      type: "string",
      description: 'Custom file mapping format: "md:.rules,path/to/file json:*.jsonc"',
      inputSources: ["flag"],
    },
    recursive: {
      type: "boolean",
      defaultValue: true,
      description: "Process directories recursively",
      inputSources: ["flag", "default"],
    },
    unescape: {
      type: "boolean",
      description: "Reverse the escape operation (convert .ts files back to original format)",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    const inputPath = resolve(ctx.options.input);
    const dryRun = ctx.options.dryRun === true;
    const force = ctx.options.force === true;
    const kind: EscapeAction["kind"] = ctx.options.unescape ? "unescape" : "convert";

    try {
      await access(inputPath);
    } catch {
      ctx.exit(1, `Input path does not exist: ${inputPath}`);
    }

    const inputStat = await stat(inputPath);
    const isDirectory = inputStat.isDirectory();
    const recursive = ctx.options.recursive;
    const actions: EscapeAction[] = [];
    const isJsonOutput = ctx.output.mode === "json";
    const files = ctx.options.unescape
      ? await findEscapedFiles(inputPath, recursive)
      : await findFiles(inputPath, ctx.options.map ? parseMap(ctx.options.map) : null, recursive);

    if (files.length === 0) {
      ctx.exit(
        1,
        ctx.options.unescape
          ? "No escaped files found to process."
          : "No files found to process.",
      );
    }

    if (!isJsonOutput) {
      ctx.out(`Processing ${files.length} file(s)...`);
    }

    const fileResults = await pMap(
      files,
      async (file) => {
        const outputPath = ctx.options.unescape
          ? getUnescapeOutputPath(inputPath, file, isDirectory)
          : getOutputPath(inputPath, file, isDirectory);
        const nextContent = ctx.options.unescape
          ? await buildUnconvertedFileContent(file)
          : await buildConvertedFileContent(file);
        const existingOutput = await readOptionalTextFile(outputPath);

        if (existingOutput === nextContent) {
          return {
            action: {
              action: "noop" as const,
              inputPath: file,
              kind,
              outputPath,
              reason: "output already up to date",
            },
            messages: isJsonOutput ? [] : [`No-op: ${outputPath} is already up to date`],
          };
        }

        if (existingOutput !== undefined && !force) {
          return {
            action: {
              action: "blocked" as const,
              inputPath: file,
              kind,
              outputPath,
              reason: "existing output differs; re-run with --force to overwrite",
            },
            messages: isJsonOutput
              ? []
              : [`Blocked: ${outputPath} already exists. Re-run with --force to overwrite.`],
          };
        }

        if (dryRun) {
          return {
            action: {
              action: "planned" as const,
              inputPath: file,
              kind,
              outputPath,
              reason:
                existingOutput === undefined
                  ? "would create output file"
                  : "would overwrite output file",
            },
            messages: isJsonOutput
              ? []
              : [
                  existingOutput === undefined
                    ? `Dry run: would write ${outputPath}`
                    : `Dry run: would overwrite ${outputPath}`,
                ],
          };
        }

        await writeOutputFile(outputPath, nextContent);
        return {
          action: {
            action: "written" as const,
            inputPath: file,
            kind,
            outputPath,
            reason:
              existingOutput === undefined ? "created output file" : "overwrote existing output file",
          },
          messages: isJsonOutput
            ? []
            : [
                kind === "unescape"
                  ? `Unescaped: ${file} -> ${outputPath}`
                  : `Converted: ${file} -> ${outputPath}`,
              ],
        };
      },
      { concurrency: 8 },
    );

    for (const result of fileResults) {
      actions.push(result.action);
      if (!isJsonOutput) {
        for (const message of result.messages) {
          ctx.out(message);
        }
      }
    }

    const summary = buildActionSummary(actions);
    const resultPayload = {
      actions,
      blocked: summary.blocked,
      command: "escape",
      dryRun,
      force,
      kind,
      noop: summary.noop,
      planned: summary.planned,
      total: summary.total,
      written: summary.written,
    };

    if (!isJsonOutput) {
      ctx.out(
        `Summary: ${summary.written} written, ${summary.planned} planned, ${summary.noop} no-op, ${summary.blocked} blocked.`,
      );
      ctx.out(
        dryRun ? "Dry run complete!" : kind === "unescape" ? "Unescape complete!" : "Conversion complete!",
      );
    }

    if (summary.blocked > 0) {
      if (isJsonOutput) {
        ctx.output.data({
          ...resultPayload,
          ok: false,
          remptsPreview: 1,
        });
      }

      ctx.exit(1, "Some outputs were blocked. Re-run with --force to overwrite them.");
    }

    if (isJsonOutput) {
      ctx.output.result(resultPayload, "escape");
    }
  },
});
