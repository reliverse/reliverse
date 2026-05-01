import { basename, dirname, extname, join, relative } from "node:path";

export function getEscapeOutputPath(
  inputPath: string,
  filePath: string,
  isDirectory: boolean,
): string {
  if (!isDirectory) {
    return `${inputPath}.ts`;
  }

  const inputDir = dirname(inputPath);
  const inputName = basename(inputPath);
  const outputDir = join(inputDir, `${inputName}-escaped`);
  const relPath = relative(inputPath, filePath);

  return `${join(outputDir, relPath)}.ts`;
}

export function getUnescapeOutputPath(
  inputPath: string,
  filePath: string,
  isDirectory: boolean,
): string {
  if (!isDirectory) {
    return removeEscapedModuleExtension(inputPath);
  }

  const inputName = basename(inputPath);
  const inputDir = dirname(inputPath);
  const outputDirName = inputName.endsWith("-escaped")
    ? `${inputName.slice(0, -"-escaped".length)}-unescaped`
    : `${inputName}-unescaped`;
  const outputDir = join(inputDir, outputDirName);
  const relPath = relative(inputPath, filePath);

  return removeEscapedModuleExtension(join(outputDir, relPath));
}

function removeEscapedModuleExtension(filePath: string): string {
  const ext = extname(filePath);

  if (ext === ".ts" || ext === ".js") {
    return filePath.slice(0, -ext.length);
  }

  return filePath;
}