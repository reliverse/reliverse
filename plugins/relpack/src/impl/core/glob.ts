import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface ArchiveInputResolution {
  readonly requested: readonly string[];
  readonly archive: string;
  readonly matches: readonly string[];
  readonly usedGlob: boolean;
  readonly selectedBy:
    | "exact"
    | "single-match"
    | "highest-version"
    | "newest-mtime"
    | "lexicographic";
}

export interface ArchiveListResolution {
  readonly requested: readonly string[];
  readonly archives: readonly ArchiveInputResolution[];
  readonly groupedShellExpansion: boolean;
}

interface CandidateScore {
  readonly candidate: string;
  readonly version: readonly number[] | undefined;
  readonly mtimeMs: number;
}

const GLOB_MAGIC_RE = /[*?[]/;
const VERSION_RE = /(\d+)\.(\d+)\.(\d+)(?:[-._+][0-9A-Za-z][0-9A-Za-z.-]*)?/g;

export function hasGlobMagic(input: string): boolean {
  return GLOB_MAGIC_RE.test(input);
}

export async function resolveArchiveInputs(
  cwd: string,
  inputs: readonly string[],
): Promise<ArchiveListResolution> {
  const requested = inputs.map((input) => input.trim()).filter(Boolean);

  if (requested.length === 0) {
    throw new Error("Archive path is required.");
  }

  if (requested.length === 1) {
    return {
      requested,
      archives: [await resolveArchiveInput(cwd, requested)],
      groupedShellExpansion: false,
    };
  }

  const directGlobResolutions: ArchiveInputResolution[] = [];
  const exactCandidates: string[] = [];

  for (const input of requested) {
    if (hasGlobMagic(input)) {
      directGlobResolutions.push(await resolveArchiveInput(cwd, [input]));
      continue;
    }

    exactCandidates.push(input);
  }

  if (exactCandidates.length === 0) {
    return { requested, archives: directGlobResolutions, groupedShellExpansion: false };
  }

  const groups = groupArchiveCandidates(exactCandidates);
  const groupedResolutions: ArchiveInputResolution[] = [];

  for (const group of groups) {
    const selection = await selectBestArchiveCandidate(cwd, group.candidates);
    groupedResolutions.push({
      requested: group.candidates,
      archive: selection.archive,
      matches: group.candidates,
      usedGlob: group.candidates.length > 1,
      selectedBy: group.candidates.length === 1 ? "exact" : selection.selectedBy,
    });
  }

  return {
    requested,
    archives: [...directGlobResolutions, ...groupedResolutions],
    groupedShellExpansion: groups.some((group) => group.candidates.length > 1),
  };
}

export function looksLikeArchiveInput(input: string): boolean {
  const lower = input.toLowerCase();
  return (
    hasGlobMagic(input) ||
    lower.endsWith(".tar") ||
    lower.endsWith(".tar.gz") ||
    lower.endsWith(".tgz") ||
    lower.endsWith(".tar.zst") ||
    lower.endsWith(".tzst") ||
    lower.endsWith(".tar.xz") ||
    lower.endsWith(".txz") ||
    lower.endsWith(".tar.bz2") ||
    lower.endsWith(".tbz2") ||
    lower.endsWith(".zip") ||
    lower.endsWith(".7z")
  );
}

function groupArchiveCandidates(
  candidates: readonly string[],
): readonly { readonly key: string; readonly candidates: readonly string[] }[] {
  const groups = new Map<string, string[]>();
  const orderedKeys: string[] = [];

  for (const candidate of candidates) {
    const key = inferArchiveCandidateGroupKey(candidate);
    if (!groups.has(key)) {
      groups.set(key, []);
      orderedKeys.push(key);
    }
    groups.get(key)!.push(candidate);
  }

  return orderedKeys.map((key) => ({ key, candidates: groups.get(key)! }));
}

function inferArchiveCandidateGroupKey(candidate: string): string {
  const basename = stripArchiveSuffix(path.basename(candidate));
  const matches = [...basename.matchAll(VERSION_RE)];
  const versionMatch = matches.at(-1);

  if (versionMatch?.index !== undefined && versionMatch.index > 0) {
    const prefix = basename.slice(0, versionMatch.index).replace(/[-._]+$/g, "");
    if (prefix.length > 0) {
      return prefix.toLowerCase();
    }
  }

  return basename.toLowerCase();
}

function stripArchiveSuffix(basename: string): string {
  const lower = basename.toLowerCase();
  const suffixes = [
    ".tar.gz",
    ".tgz",
    ".tar.zst",
    ".tzst",
    ".tar.xz",
    ".txz",
    ".tar.bz2",
    ".tbz2",
    ".tar",
    ".zip",
    ".7z",
  ];

  for (const suffix of suffixes) {
    if (lower.endsWith(suffix)) {
      return basename.slice(0, -suffix.length);
    }
  }

  return basename;
}

export async function resolveArchiveInput(
  cwd: string,
  inputs: readonly string[],
): Promise<ArchiveInputResolution> {
  const requested = inputs.map((input) => input.trim()).filter(Boolean);

  if (requested.length === 0) {
    throw new Error("Archive path is required.");
  }

  if (requested.length === 1) {
    const input = requested[0]!;
    if (!hasGlobMagic(input)) {
      return {
        requested,
        archive: input,
        matches: [input],
        usedGlob: false,
        selectedBy: "exact",
      };
    }

    const matches = await expandPathGlob(cwd, input);
    if (matches.length === 0) {
      throw new Error(`No archive matched glob pattern: ${input}`);
    }

    const selection = await selectBestArchiveCandidate(cwd, matches);
    return {
      requested,
      archive: selection.archive,
      matches,
      usedGlob: true,
      selectedBy: matches.length === 1 ? "single-match" : selection.selectedBy,
    };
  }

  const selection = await selectBestArchiveCandidate(cwd, requested);
  return {
    requested,
    archive: selection.archive,
    matches: requested,
    usedGlob: true,
    selectedBy: selection.selectedBy,
  };
}

async function expandPathGlob(cwd: string, pattern: string): Promise<string[]> {
  const normalizedPattern = normalizeSlashes(pattern);
  const absolutePattern = path.isAbsolute(pattern)
    ? normalizeSlashes(path.resolve(pattern))
    : normalizeSlashes(path.resolve(cwd, pattern));
  const cwdNormalized = normalizeSlashes(path.resolve(cwd));
  const patternSegments = absolutePattern.split("/").filter(Boolean);
  const root = absolutePattern.startsWith("/") ? "/" : "";
  const firstMagicIndex = patternSegments.findIndex((segment) => hasGlobMagic(segment));

  if (firstMagicIndex === -1) {
    return [pattern];
  }

  const baseSegments = patternSegments.slice(0, firstMagicIndex);
  const globSegments = patternSegments.slice(firstMagicIndex);
  const baseDir = root + baseSegments.join("/");
  const matches = await walkGlob(baseDir || root || cwd, globSegments);

  return matches
    .map((match) => toDisplayPath(cwdNormalized, match, normalizedPattern))
    .sort(comparePathNames);
}

async function walkGlob(baseDir: string, segments: readonly string[]): Promise<string[]> {
  if (segments.length === 0) {
    try {
      const info = await stat(baseDir);
      return info.isFile() ? [baseDir] : [];
    } catch {
      return [];
    }
  }

  const [segment = "", ...rest] = segments;

  if (segment === "**") {
    const directMatches = await walkGlob(baseDir, rest);
    const childDirs = await listChildDirectories(baseDir);
    const nestedMatches: string[] = [];
    for (const childDir of childDirs) {
      nestedMatches.push(...(await walkGlob(childDir, segments)));
    }
    return [...directMatches, ...nestedMatches];
  }

  const entries = await listDirectoryEntries(baseDir);
  const matcher = segmentToRegExp(segment);
  const matches: string[] = [];

  for (const entry of entries) {
    if (!matcher.test(entry.name)) {
      continue;
    }

    const entryPath = path.join(baseDir, entry.name);
    if (rest.length === 0) {
      if (entry.isFile()) {
        matches.push(entryPath);
      }
      continue;
    }

    if (entry.isDirectory()) {
      matches.push(...(await walkGlob(entryPath, rest)));
    }
  }

  return matches;
}

async function listDirectoryEntries(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function listChildDirectories(directory: string): Promise<string[]> {
  const entries = await listDirectoryEntries(directory);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name));
}

function segmentToRegExp(segment: string): RegExp {
  let source = "^";

  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index]!;

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    if (char === "[") {
      const end = segment.indexOf("]", index + 1);
      if (end !== -1) {
        const classBody = segment.slice(index + 1, end);
        source += `[${classBody.replace(/\\/g, "\\\\")}]`;
        index = end;
        continue;
      }
    }

    source += escapeRegExp(char);
  }

  source += "$";
  return new RegExp(source);
}

async function selectBestArchiveCandidate(
  cwd: string,
  candidates: readonly string[],
): Promise<{
  readonly archive: string;
  readonly selectedBy: ArchiveInputResolution["selectedBy"];
}> {
  const uniqueCandidates = unique(candidates).sort(comparePathNames);
  if (uniqueCandidates.length === 1) {
    return { archive: uniqueCandidates[0]!, selectedBy: "single-match" };
  }

  const scores = await Promise.all(
    uniqueCandidates.map((candidate) => scoreCandidate(cwd, candidate)),
  );
  const withVersions = scores.filter(
    (score): score is CandidateScore & { readonly version: readonly number[] } =>
      score.version !== undefined,
  );

  if (withVersions.length > 0) {
    const selected = [...withVersions].sort(compareScoresByVersionThenName).at(-1)!;
    return { archive: selected.candidate, selectedBy: "highest-version" };
  }

  const withMtime = scores.filter((score) => score.mtimeMs > 0);
  if (withMtime.length > 0) {
    const selected = [...withMtime].sort(compareScoresByMtimeThenName).at(-1)!;
    return { archive: selected.candidate, selectedBy: "newest-mtime" };
  }

  return { archive: uniqueCandidates.at(-1)!, selectedBy: "lexicographic" };
}

async function scoreCandidate(cwd: string, candidate: string): Promise<CandidateScore> {
  const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
  let mtimeMs = 0;
  try {
    const info = await stat(absolute);
    mtimeMs = info.mtimeMs;
  } catch {
    mtimeMs = 0;
  }

  return {
    candidate,
    version: extractVersion(candidate),
    mtimeMs,
  };
}

function extractVersion(candidate: string): readonly number[] | undefined {
  const basename = path.basename(candidate);
  const matches = [...basename.matchAll(VERSION_RE)];
  const last = matches.at(-1);
  if (last === undefined) {
    return undefined;
  }

  return [Number(last[1]!), Number(last[2]!), Number(last[3]!)];
}

function compareScoresByVersionThenName(a: CandidateScore, b: CandidateScore): number {
  const versionCompare = compareVersions(a.version ?? [], b.version ?? []);
  return versionCompare === 0 ? comparePathNames(a.candidate, b.candidate) : versionCompare;
}

function compareScoresByMtimeThenName(a: CandidateScore, b: CandidateScore): number {
  if (a.mtimeMs !== b.mtimeMs) {
    return a.mtimeMs - b.mtimeMs;
  }

  return comparePathNames(a.candidate, b.candidate);
}

function compareVersions(a: readonly number[], b: readonly number[]): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) {
      return left - right;
    }
  }

  return 0;
}

function toDisplayPath(cwd: string, absoluteMatch: string, originalPattern: string): string {
  const normalizedMatch = normalizeSlashes(path.resolve(absoluteMatch));
  if (!isPathInsideOrSame(cwd, normalizedMatch)) {
    return normalizedMatch;
  }

  const relative = normalizeSlashes(path.relative(cwd, normalizedMatch));
  const prefix = originalPattern.startsWith("./") ? "./" : "";
  return `${prefix}${relative}`;
}

function isPathInsideOrSame(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function comparePathNames(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
