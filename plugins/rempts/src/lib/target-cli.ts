import { access, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface RemptsTargetOptions {
  readonly cli?: string | undefined;
  readonly global?: boolean | undefined;
  readonly strictGlobal?: boolean | undefined;
}

interface PackageManifest {
  readonly workspaces?: readonly string[] | { readonly packages?: readonly string[] | undefined } | undefined;
  readonly name?: string | undefined;
  readonly bin?: string | Record<string, string> | undefined;
}

interface ResolvedTargetCli {
  readonly binName: string;
  readonly binPath: string;
  readonly command: readonly string[];
  readonly mode: "global" | "local";
  readonly packageName?: string | undefined;
  readonly requestedTarget: string;
}

export interface TargetResolutionAttempt {
  readonly detail: string;
  readonly kind: "global-bin" | "global-package" | "local-bin" | "local-package" | "local-workspace";
  readonly root?: string | undefined;
  readonly success: boolean;
}

export interface TargetResolutionReport {
  readonly attempts: readonly TargetResolutionAttempt[];
  readonly cwd: string;
  readonly hostRoots: readonly string[];
  readonly requestedTarget?: string | undefined;
  readonly resolutionPolicy: "auto" | "prefer-global" | "strict-global" | "strict-local";
  readonly resolved: ResolvedTargetCli | null;
}

interface StructuredRemptsResult<TData = unknown> {
  readonly command?: string | undefined;
  readonly data: TData;
  readonly ok: true;
  readonly remptsResult: 1;
  readonly schemaVersion: 1;
}

interface StructuredRemptsError {
  readonly code?: string | undefined;
  readonly message: string;
  readonly ok: false;
  readonly remptsError: 1;
  readonly schemaVersion: 1;
}

function getBunInstallRoot(): string {
  return process.env.BUN_INSTALL || join(homedir(), ".bun");
}

function getGlobalBinDirectory(): string {
  return join(getBunInstallRoot(), "bin");
}

function getGlobalNodeModulesDirectory(): string {
  return join(getBunInstallRoot(), "install", "global", "node_modules");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findNearestPackageRoot(startDir: string): Promise<string | null> {
  let dir = resolve(startDir);

  for (;;) {
    if (await fileExists(join(dir, "package.json"))) {
      return dir;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

async function findPackageRootsUpward(startDir: string): Promise<readonly string[]> {
  let dir = resolve(startDir);
  const roots: string[] = [];

  for (;;) {
    if (await fileExists(join(dir, "package.json"))) {
      roots.push(dir);
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return roots;
    }
    dir = parent;
  }
}

async function readManifest(path: string): Promise<PackageManifest> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as PackageManifest;
}

function getWorkspacePatterns(manifest: PackageManifest): readonly string[] {
  if (Array.isArray(manifest.workspaces)) {
    return manifest.workspaces.filter((entry): entry is string => typeof entry === "string");
  }

  if (manifest.workspaces && typeof manifest.workspaces === "object" && !Array.isArray(manifest.workspaces)) {
    const packages = (manifest.workspaces as { readonly packages?: readonly string[] | undefined }).packages;
    if (Array.isArray(packages)) {
      return packages.filter((entry): entry is string => typeof entry === "string");
    }
  }

  return [];
}

function isPackageLike(target: string): boolean {
  return target.startsWith("@") || target.includes("/");
}

function pickBinName(manifest: PackageManifest, requestedTarget: string): string | null {
  if (!manifest.bin) {
    return null;
  }

  if (typeof manifest.bin === "string") {
    if (manifest.name?.startsWith("@")) {
      const scopedName = manifest.name.split("/").at(1);
      return scopedName ?? requestedTarget;
    }

    return manifest.name ?? requestedTarget;
  }

  if (requestedTarget in manifest.bin) {
    return requestedTarget;
  }

  const names = Object.keys(manifest.bin);
  return names[0] ?? null;
}

async function resolveLocalTargetByPackage(hostRoot: string, target: string): Promise<ResolvedTargetCli | null> {
  const hostManifest = join(hostRoot, "package.json");
  const hostRequire = createRequire(hostManifest);

  try {
    const packageJsonPath = hostRequire.resolve(`${target}/package.json`);
    const manifest = await readManifest(packageJsonPath);
    const binName = pickBinName(manifest, target);

    if (!binName) {
      return null;
    }

    const binPath = join(hostRoot, "node_modules", ".bin", binName);
    if (!(await fileExists(binPath))) {
      return null;
    }

    return {
      binName,
      binPath,
      command: [binPath],
      mode: "local",
      packageName: manifest.name,
      requestedTarget: target,
    };
  } catch {
    return null;
  }
}

async function resolveGlobalTargetByPackage(target: string): Promise<ResolvedTargetCli | null> {
  const packageJsonPath = join(getGlobalNodeModulesDirectory(), target, "package.json");
  if (!(await fileExists(packageJsonPath))) {
    return null;
  }

  const manifest = await readManifest(packageJsonPath);
  const binName = pickBinName(manifest, target);
  if (!binName) {
    return null;
  }

  const binPath = join(getGlobalBinDirectory(), binName);
  if (!(await fileExists(binPath))) {
    return null;
  }

  return {
    binName,
    binPath,
    command: [binPath],
    mode: "global",
    packageName: manifest.name,
    requestedTarget: target,
  };
}

async function resolveLocalTargetByBin(hostRoot: string, target: string): Promise<ResolvedTargetCli | null> {
  const binPath = join(hostRoot, "node_modules", ".bin", target);
  if (!(await fileExists(binPath))) {
    return null;
  }

  return {
    binName: target,
    binPath,
    command: [binPath],
    mode: "local",
    requestedTarget: target,
  };
}

async function resolveGlobalTargetByBin(target: string): Promise<ResolvedTargetCli | null> {
  const binPath = join(getGlobalBinDirectory(), target);
  if (!(await fileExists(binPath))) {
    return null;
  }

  return {
    binName: target,
    binPath,
    command: [binPath],
    mode: "global",
    requestedTarget: target,
  };
}

async function expandWorkspacePattern(hostRoot: string, pattern: string): Promise<readonly string[]> {
  if (!pattern.includes("*")) {
    const manifestPath = join(hostRoot, pattern, "package.json");
    return (await fileExists(manifestPath)) ? [manifestPath] : [];
  }

  const starIndex = pattern.indexOf("*");
  const prefix = pattern.slice(0, starIndex).replace(/\/$/, "");
  const suffix = pattern.slice(starIndex + 1).replace(/^\//, "");
  const baseDir = join(hostRoot, prefix);

  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    const manifests = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const manifestPath = join(baseDir, entry.name, suffix, "package.json");
          return (await fileExists(manifestPath)) ? manifestPath : null;
        }),
    );

    return manifests.filter((value): value is string => value !== null);
  } catch {
    return [];
  }
}

async function getWorkspaceManifestPaths(hostRoot: string): Promise<readonly string[]> {
  const hostManifest = await readManifest(join(hostRoot, "package.json"));
  const patterns = getWorkspacePatterns(hostManifest);
  const manifests = await Promise.all(patterns.map((pattern) => expandWorkspacePattern(hostRoot, pattern)));
  return manifests.flat();
}

async function resolveLocalWorkspaceTarget(hostRoot: string, target: string): Promise<ResolvedTargetCli | null> {
  const manifestPaths = await getWorkspaceManifestPaths(hostRoot);

  for (const manifestPath of manifestPaths) {
    const manifest = await readManifest(manifestPath);
    const packageRoot = dirname(manifestPath);

    if (manifest.name === target) {
      const binName = pickBinName(manifest, target);
      if (!binName || !manifest.bin) {
        continue;
      }

      const relativeBin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin[binName];
      if (!relativeBin) {
        continue;
      }

      const binPath = join(packageRoot, relativeBin);
      return {
        binName,
        binPath,
        command: ["bun", binPath],
        mode: "local",
        packageName: manifest.name,
        requestedTarget: target,
      };
    }

    if (typeof manifest.bin === "object" && manifest.bin && target in manifest.bin) {
      const binPath = join(packageRoot, manifest.bin[target] as string);
      return {
        binName: target,
        binPath,
        command: ["bun", binPath],
        mode: "local",
        packageName: manifest.name,
        requestedTarget: target,
      };
    }
  }

  return null;
}

export function getRemptsTargetOptions(raw: unknown): RemptsTargetOptions {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const record = raw as Record<string, unknown>;
  return {
    cli: typeof record.cli === "string" ? record.cli : undefined,
    global: typeof record.global === "boolean" ? record.global : undefined,
    strictGlobal: typeof record.strictGlobal === "boolean" ? record.strictGlobal : undefined,
  };
}

function getResolutionPolicy(target: RemptsTargetOptions): TargetResolutionReport["resolutionPolicy"] {
  if (target.strictGlobal) {
    return "strict-global";
  }

  if (target.global === true) {
    return "prefer-global";
  }

  if (target.global === false) {
    return "strict-local";
  }

  return "auto";
}

export async function resolveTargetCli(
  cwd: string,
  raw: unknown,
): Promise<ResolvedTargetCli | null> {
  const report = await inspectTargetCliResolution(cwd, raw);
  return report.resolved;
}

export async function inspectTargetCliResolution(
  cwd: string,
  raw: unknown,
): Promise<TargetResolutionReport> {
  const target = getRemptsTargetOptions(raw);
  if (!target.cli) {
    return {
      attempts: [],
      cwd,
      hostRoots: await findPackageRootsUpward(cwd),
      requestedTarget: undefined,
      resolutionPolicy: getResolutionPolicy(target),
      resolved: null,
    };
  }

  const targetCli = target.cli;
  const hostRoots = await findPackageRootsUpward(cwd);
  const resolutionPolicy = getResolutionPolicy(target);
  const searchOrder =
    resolutionPolicy === "strict-global"
      ? (["global"] as const)
      : resolutionPolicy === "prefer-global"
        ? (["global", "local"] as const)
        : resolutionPolicy === "strict-local"
          ? (["local"] as const)
          : (["local", "global"] as const);
  const packageLike = isPackageLike(targetCli);
  const attempts: TargetResolutionAttempt[] = [];

  for (const mode of searchOrder) {
    if (packageLike) {
      const resolved =
        mode === "local"
          ? await (async () => {
              for (const candidateRoot of hostRoots) {
                const fromPackage = await resolveLocalTargetByPackage(candidateRoot, targetCli);
                attempts.push({
                  detail: fromPackage
                    ? `Resolved package from local node_modules at ${candidateRoot}.`
                    : `No matching local package dependency at ${candidateRoot}.`,
                  kind: "local-package",
                  root: candidateRoot,
                  success: Boolean(fromPackage),
                });
                if (fromPackage) {
                  return fromPackage;
                }

                const fromWorkspace = await resolveLocalWorkspaceTarget(candidateRoot, targetCli);
                attempts.push({
                  detail: fromWorkspace
                    ? `Resolved workspace package/bin from ${candidateRoot}.`
                    : `No matching workspace package/bin under ${candidateRoot}.`,
                  kind: "local-workspace",
                  root: candidateRoot,
                  success: Boolean(fromWorkspace),
                });
                if (fromWorkspace) {
                  return fromWorkspace;
                }
              }

              return null;
            })()
          : await (async () => {
              const resolvedGlobal = await resolveGlobalTargetByPackage(targetCli);
              attempts.push({
                detail: resolvedGlobal
                  ? `Resolved global package from ${getGlobalNodeModulesDirectory()}.`
                  : `No matching global package under ${getGlobalNodeModulesDirectory()}.`,
                kind: "global-package",
                root: getGlobalNodeModulesDirectory(),
                success: Boolean(resolvedGlobal),
              });
              return resolvedGlobal;
            })();

      if (resolved) {
        return {
          attempts,
          cwd,
          hostRoots,
          requestedTarget: targetCli,
          resolutionPolicy,
          resolved,
        };
      }

      continue;
    }

    const resolved =
      mode === "local"
        ? await (async () => {
            for (const candidateRoot of hostRoots) {
              const fromBin = await resolveLocalTargetByBin(candidateRoot, targetCli);
              attempts.push({
                detail: fromBin
                  ? `Resolved local bin shim at ${candidateRoot}.`
                  : `No matching local bin shim at ${candidateRoot}.`,
                kind: "local-bin",
                root: candidateRoot,
                success: Boolean(fromBin),
              });
              if (fromBin) {
                return fromBin;
              }

              const fromWorkspace = await resolveLocalWorkspaceTarget(candidateRoot, targetCli);
              attempts.push({
                detail: fromWorkspace
                  ? `Resolved workspace package/bin from ${candidateRoot}.`
                  : `No matching workspace package/bin under ${candidateRoot}.`,
                kind: "local-workspace",
                root: candidateRoot,
                success: Boolean(fromWorkspace),
              });
              if (fromWorkspace) {
                return fromWorkspace;
              }
            }

            return null;
          })()
        : await (async () => {
            const resolvedGlobal = await resolveGlobalTargetByBin(targetCli);
            attempts.push({
              detail: resolvedGlobal
                ? `Resolved global bin at ${getGlobalBinDirectory()}.`
                : `No matching global bin at ${getGlobalBinDirectory()}.`,
              kind: "global-bin",
              root: getGlobalBinDirectory(),
              success: Boolean(resolvedGlobal),
            });
            return resolvedGlobal;
          })();

    if (resolved) {
      return {
        attempts,
        cwd,
        hostRoots,
        requestedTarget: targetCli,
        resolutionPolicy,
        resolved,
      };
    }
  }

  return {
    attempts,
    cwd,
    hostRoots,
    requestedTarget: targetCli,
    resolutionPolicy,
    resolved: null,
  };
}

function toErrorMessage(error: StructuredRemptsError): string {
  return error.code ? `${error.message} [${error.code}]` : error.message;
}

export async function runTargetRemptsCommand<TData>(options: {
  readonly cwd: string;
  readonly commandPath: readonly string[];
  readonly rawTargetOptions: unknown;
}): Promise<{ readonly target: ResolvedTargetCli; readonly data: TData }> {
  const resolution = await inspectTargetCliResolution(options.cwd, options.rawTargetOptions);
  const target = resolution.resolved;

  if (!target) {
    const label = resolution.requestedTarget ?? "(missing target)";
    throw new Error(
      `Could not resolve target CLI \"${label}\" with resolution policy \"${resolution.resolutionPolicy}\".`,
    );
  }

  const proc = Bun.spawn({
    cmd: [...target.command, ...options.commandPath, "--json"],
    cwd: options.cwd,
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  let parsed: StructuredRemptsResult<TData> | StructuredRemptsError | null = null;
  try {
    parsed = JSON.parse(stdout) as StructuredRemptsResult<TData> | StructuredRemptsError;
  } catch {
    parsed = null;
  }

  if (parsed && "ok" in parsed && parsed.ok === true) {
    return {
      data: parsed.data,
      target,
    };
  }

  if (parsed && "ok" in parsed && parsed.ok === false) {
    throw new Error(toErrorMessage(parsed));
  }

  if (exitCode !== 0) {
    const message = stderr.trim() || stdout.trim() || `Target CLI exited with code ${exitCode}.`;
    throw new Error(message);
  }

  throw new Error(`Target CLI \"${target.requestedTarget}\" did not return a valid JSON Rempts result.`);
}
