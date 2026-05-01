import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

import {
  DEFAULT_ESCAPE_EXTENSIONS,
  DEFAULT_IGNORED_DIRECTORY_NAMES,
  ESCAPED_MODULE_EXTENSIONS,
} from "./constants";
import type { FileMapping } from "./types";

export async function readTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf-8");
}

export async function readOptionalTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await readTextFile(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

export async function findConvertibleFiles(
  inputPath: string,
  mappings: readonly FileMapping[] | null,
  recursive: boolean,
): Promise<string[]> {
  const inputStat = await stat(inputPath);

  if (inputStat.isFile()) {
    return [inputPath];
  }

  if (!inputStat.isDirectory()) {
    throw new Error(`Input path is neither a file nor a directory: ${inputPath}`);
  }

  const files = await walkFiles(inputPath, recursive);
  return files.filter((filePath) => shouldConvertFile(inputPath, filePath, mappings));
}

export async function findEscapedFiles(inputPath: string, recursive: boolean): Promise<string[]> {
  const inputStat = await stat(inputPath);

  if (inputStat.isFile()) {
    return isEscapedModuleFile(inputPath) ? [inputPath] : [];
  }

  if (!inputStat.isDirectory()) {
    throw new Error(`Input path is neither a file nor a directory: ${inputPath}`);
  }

  const files = await walkFiles(inputPath, recursive);
  return files.filter(isEscapedModuleFile);
}

export function parseMap(mapString: string): FileMapping[] {
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

    if (patterns.length > 0) {
      mappings.push({ format, patterns });
    }
  }

  return mappings;
}

async function walkFiles(inputPath: string, recursive: boolean): Promise<string[]> {
  const files: string[] = [];

  async function walkDir(dirPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (recursive && !DEFAULT_IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          await walkDir(fullPath);
        }

        continue;
      }

      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walkDir(inputPath);
  files.sort((left, right) => left.localeCompare(right));

  return files;
}

function shouldConvertFile(
  baseDir: string,
  filePath: string,
  mappings: readonly FileMapping[] | null,
): boolean {
  if (DEFAULT_ESCAPE_EXTENSIONS.has(extname(filePath))) {
    return true;
  }

  if (!mappings) {
    return false;
  }

  return mappings.some((mapping) =>
    mapping.patterns.some((pattern) => matchesPattern(baseDir, filePath, mapping.format, pattern)),
  );
}

function matchesPattern(
  baseDir: string,
  filePath: string,
  format: string,
  pattern: string,
): boolean {
  const ext = extname(filePath);

  if (pattern === "*") {
    return ext === normalizeExtension(format);
  }

  if (pattern.startsWith("*.")) {
    return ext === normalizeExtension(pattern.slice(1));
  }

  return resolve(filePath) === resolve(join(baseDir, pattern));
}

function normalizeExtension(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function isEscapedModuleFile(filePath: string): boolean {
  return ESCAPED_MODULE_EXTENSIONS.has(extname(filePath)) && !isDeclarationFile(filePath);
}

function isDeclarationFile(filePath: string): boolean {
  return filePath.endsWith(".d.ts") || filePath.endsWith(".d.mts") || filePath.endsWith(".d.cts");
}

type NodeError = Error & {
  code?: string;
};

function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error;
}
