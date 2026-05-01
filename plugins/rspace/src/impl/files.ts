import { access, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_IGNORED_DIRS,
  DEFAULT_IGNORED_EXTENSIONS,
  DEFAULT_IGNORED_FILES,
} from "./constants";
import { toPosixPath } from "./paths";

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function assertDirectory(targetPath: string, label = "Path"): Promise<void> {
  const stats = await stat(targetPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`${label} does not exist: ${targetPath}`);
    }

    throw error;
  });

  if (!stats.isDirectory()) {
    throw new Error(`${label} must be a directory: ${targetPath}`);
  }
}

export async function assertFile(targetPath: string, label = "Path"): Promise<void> {
  const stats = await stat(targetPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`${label} does not exist: ${targetPath}`);
    }

    throw error;
  });

  if (!stats.isFile()) {
    throw new Error(`${label} must be a file: ${targetPath}`);
  }
}

export async function assertCanWriteOutput(targetPath: string, overwrite: boolean): Promise<void> {
  const exists = await pathExists(targetPath);

  if (!exists) {
    return;
  }

  if (!overwrite) {
    throw new Error(`Output already exists: ${targetPath}. Pass --overwrite to replace it.`);
  }

  await rm(targetPath, {
    recursive: true,
    force: true,
  });
}

export async function writeTextFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(root, relativePath);

  await mkdir(path.dirname(absolutePath), {
    recursive: true,
  });

  await writeFile(absolutePath, content, "utf8");
}

export async function readTextFile(targetPath: string): Promise<string> {
  return await readFile(targetPath, "utf8");
}

export async function readJsonFile<T>(targetPath: string): Promise<T> {
  const text = await readTextFile(targetPath);

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON file ${targetPath}: ${detail}`);
  }
}

export async function copyDirectorySafe(input: { from: string; to: string }): Promise<string[]> {
  const copied: string[] = [];

  await copyDirectoryRecursive({
    fromRoot: input.from,
    from: input.from,
    toRoot: input.to,
    to: input.to,
    copied,
  });

  return copied.sort((a, b) => a.localeCompare(b));
}

async function copyDirectoryRecursive(input: {
  fromRoot: string;
  from: string;
  toRoot: string;
  to: string;
  copied: string[];
}): Promise<void> {
  await mkdir(input.to, {
    recursive: true,
  });

  const entries = await readdir(input.from, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (shouldIgnoreEntry(entry.name)) {
      continue;
    }

    const fromPath = path.join(input.from, entry.name);
    const toPath = path.join(input.to, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryRecursive({
        ...input,
        from: fromPath,
        to: toPath,
      });

      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    await mkdir(path.dirname(toPath), {
      recursive: true,
    });
    await writeFile(toPath, await readFile(fromPath));

    input.copied.push(toPosixPath(path.relative(input.toRoot, toPath)));
  }
}

function shouldIgnoreEntry(name: string): boolean {
  if (DEFAULT_IGNORED_DIRS.has(name)) {
    return true;
  }

  if (DEFAULT_IGNORED_FILES.has(name)) {
    return true;
  }

  if (name.endsWith("~")) {
    return true;
  }

  const extension = path.extname(name);

  return DEFAULT_IGNORED_EXTENSIONS.has(extension);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
