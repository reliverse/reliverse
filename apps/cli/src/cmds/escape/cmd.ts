import { existsSync, statSync } from "node:fs";
import { statSync, unlinkSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

import { defineArgs, defineCommand } from "@reliverse/rempts";
import { logger } from "@reliverse/logger";

export interface EscapeArgs {
  input: string;
  map?: string;
  recursive?: boolean;
  unescape?: boolean;
}

interface FileMapping {
  format: string;
  patterns: string[];
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

export function parseMap(mapString: string): FileMapping[] {
  const mappings: FileMapping[] = [];
  const parts = mapString.trim().split(/\s+/);

  for (const part of parts) {
    const [format, files] = part.split(":", 2);
    if (!format || !files) continue;

    const patterns = files
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    mappings.push({ format, patterns });
  }

  return mappings;
}

export async function findFiles(
  inputPath: string,
  mappings: FileMapping[] | null,
  recursive: boolean,
): Promise<string[]> {
  const files: string[] = [];
  const inputStat = statSync(inputPath);

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
      } else if (entry.isFile()) {
        let shouldInclude = false;

        // Always check default extensions
        const ext = extname(entry.name);
        if (defaultExtensions.includes(ext)) {
          shouldInclude = true;
        }

        // Check custom mappings if provided (additive to defaults)
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
            if (shouldInclude) break;
          }
        }

        if (shouldInclude) {
          files.push(fullPath);
        }
      }
    }
  }

  await walkDir(inputPath, inputPath);
  return files;
}

function isDeclarationFile(filename: string): boolean {
  return filename.endsWith(".d.ts") || filename.endsWith(".d.mts") || filename.endsWith(".d.cts");
}

export async function findEscapedFiles(inputPath: string, recursive: boolean): Promise<string[]> {
  const files: string[] = [];
  const inputStat = statSync(inputPath);

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
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if ((ext === ".ts" || ext === ".js") && !isDeclarationFile(entry.name)) {
          files.push(fullPath);
        }
      }
    }
  }

  await walkDir(inputPath);
  return files;
}

export function getOutputPath(inputPath: string, filePath: string, isDirectory: boolean): string {
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

export function getUnescapeOutputPath(
  inputPath: string,
  filePath: string,
  isDirectory: boolean,
): string {
  if (isDirectory) {
    const inputName = basename(inputPath);
    const inputDir = dirname(inputPath);
    let outputDirName: string;

    if (inputName.endsWith("-escaped")) {
      const originalName = inputName.slice(0, -8);
      outputDirName = `${originalName}-unescaped`;
    } else {
      outputDirName = `${inputName}-unescaped`;
    }

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

export async function convertFile(inputPath: string, outputPath: string): Promise<void> {
  const content = await readFile(inputPath, "utf-8");
  const escaped = escapeContent(content);
  const tsContent = `export const content = \`${escaped}\`;\n`;

  const outputDir = dirname(outputPath);
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, tsContent, "utf-8");
}

export async function unconvertFile(inputPath: string, outputPath: string): Promise<void> {
  const tsContent = await readFile(inputPath, "utf-8");
  const escapedContent = extractContentFromTs(tsContent);
  const content = unescapeContent(escapedContent);

  const outputDir = dirname(outputPath);
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, content, "utf-8");
}

export async function bootstrapEscapedFiles(
  escapedDir: string,
  outputDir: string,
): Promise<string[]> {
  const files = await findEscapedFiles(escapedDir, true);
  const outputFiles: string[] = [];

  for (const file of files) {
    const relPath = relative(escapedDir, file);
    const ext = extname(relPath);
    const outputFile =
      ext === ".ts" || ext === ".js"
        ? join(outputDir, relPath.slice(0, -ext.length))
        : join(outputDir, relPath.slice(0, -3));
    await unconvertFile(file, outputFile);
    outputFiles.push(outputFile);
  }

  return outputFiles;
}

/**
 * Find all files in a directory recursively, excluding .hbs files
 */
export async function findAllTemplateFiles(
  inputPath: string,
  excludeExtensions: string[] = [".hbs"],
): Promise<string[]> {
  const files: string[] = [];
  const inputStat = statSync(inputPath);

  if (!inputStat.isDirectory()) {
    throw new Error(`Input path is not a directory: ${inputPath}`);
  }

  async function walkDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        // Exclude files with specified extensions
        if (!excludeExtensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  await walkDir(inputPath);
  return files;
}

/**
 * Get output path with double extension (e.g., loader.tsx -> loader.tsx.ts)
 */
export function getDoubleExtensionOutputPath(
  inputPath: string,
  filePath: string,
  baseDir: string,
): string {
  const relPath = relative(baseDir, filePath);
  return join(inputPath, `${relPath}.ts`);
}

/**
 * Escape all template files in a directory (except excluded extensions)
 * Creates escaped files with double extensions (e.g., loader.tsx.ts)
 * Deletes original files after escaping
 */
export async function escapeTemplateFiles(
  templatesDir: string,
  outputDir: string,
  excludeExtensions: string[] = [".hbs"],
): Promise<string[]> {
  const files = await findAllTemplateFiles(templatesDir, excludeExtensions);
  const escapedFiles: string[] = [];

  for (const file of files) {
    const outputPath = getDoubleExtensionOutputPath(outputDir, file, templatesDir);
    await convertFile(file, outputPath);
    escapedFiles.push(outputPath);
    // Delete original file after escaping
    unlinkSync(file);
  }

  return escapedFiles;
}

export default defineCommand({
  meta: {
    name: "escape",
    description:
      "Convert files (.md, .mdc, .mdx, .json, .jsonc, .toml) to TypeScript with proper escaping",
    examples: [
      'escape --input "path/to/file.md"',
      'escape --input "path/to/dir"',
      'escape --input "path/to/dir" --map "md:.rules,path/to/file json:*.markdown"',
      'escape --input "path/to/dir-escaped" --unescape',
    ],
  },
  args: defineArgs({
    input: {
      type: "string",
      required: true,
      description: "Path to file or directory to process",
    },
    map: {
      type: "string",
      description: 'Custom file mapping format: "md:.rules,path/to/file json:*.jsonc"',
    },
    recursive: {
      type: "boolean",
      description: "Process directories recursively (default: true)",
    },
    unescape: {
      type: "boolean",
      description: "Reverse the escape operation (convert .ts files back to original format)",
    },
  }),
  run: async ({ args }) => {
    const inputPath = resolve(args.input);

    if (!existsSync(inputPath)) {
      throw new Error(`Input path does not exist: ${inputPath}`);
    }

    const inputStat = statSync(inputPath);
    const isDirectory = inputStat.isDirectory();
    const recursive = args.recursive ?? true;

    if (args.unescape) {
      const files = await findEscapedFiles(inputPath, recursive);

      if (files.length === 0) {
        logger.warn("No escaped files found to process");
        return;
      }

      logger.info(`Processing ${files.length} file(s)...`);

      for (const file of files) {
        const outputPath = getUnescapeOutputPath(inputPath, file, isDirectory);
        await unconvertFile(file, outputPath);
        logger.info(`Unescaped: ${file} → ${outputPath}`);
      }

      logger.info("Unescape complete!");
    } else {
      const mappings = args.map ? parseMap(args.map) : null;

      const files = await findFiles(inputPath, mappings, recursive);

      if (files.length === 0) {
        logger.warn("No files found to process");
        return;
      }

      logger.info(`Processing ${files.length} file(s)...`);

      for (const file of files) {
        const outputPath = getOutputPath(inputPath, file, isDirectory);
        await convertFile(file, outputPath);
        logger.info(`Converted: ${file} → ${outputPath}`);
      }

      logger.info("Conversion complete!");
    }
  },
});
