import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import pMap from "p-map";

import { getBunLockfilePath } from "./lockfile";
import {
  defaultSocketShallowChecker,
  type SocketSeverity,
  type SocketShallowChecker,
  type SocketShallowCheckResult,
} from "./safe/latest";

export interface BunLockPackage {
  readonly integrity?: string | undefined;
  readonly name: string;
  readonly resolution: string;
  readonly version: string;
}

export interface VerifyLockIssue {
  readonly packageName?: string | undefined;
  readonly reason: string;
  readonly severity: "error" | "warning";
  readonly version?: string | undefined;
}

export interface VerifyLockResult {
  readonly checkedPackages: number;
  readonly lockfilePath: string;
  readonly ok: boolean;
  readonly packages: readonly BunLockPackage[];
  readonly socket?:
    | {
        readonly enabled: boolean;
        readonly require: boolean;
        readonly severityThreshold: SocketSeverity;
      }
    | undefined;
  readonly issues: readonly VerifyLockIssue[];
}

interface BunLockPackageEntry {
  readonly integrity?: string | undefined;
  readonly resolution: string;
}

const SEVERITY_RANK: Record<SocketSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseResolution(resolution: string): { name: string; version: string } | null {
  if (resolution.includes("@workspace:")) return null;

  const separatorIndex = resolution.lastIndexOf("@");
  if (separatorIndex <= 0) return null;

  const name = resolution.slice(0, separatorIndex);
  const version = resolution.slice(separatorIndex + 1);

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    return null;
  }

  return { name, version };
}

function parseBunLockPackageEntry(value: unknown): BunLockPackageEntry | null {
  if (!Array.isArray(value)) return null;
  const resolution = value[0];
  if (typeof resolution !== "string") return null;
  const integrity = typeof value[3] === "string" ? value[3] : undefined;
  return { integrity, resolution };
}

export function parseBunLockPackages(
  raw: string,
  lockfilePath = "bun.lock",
): readonly BunLockPackage[] {
  const errors: ParseError[] = [];
  const parsed = parse(raw, errors, { allowTrailingComma: true }) as unknown;

  if (errors.length > 0) {
    const details = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(", ");
    throw new Error(`${lockfilePath} contains invalid Bun lockfile JSONC: ${details}`);
  }

  if (!isObject(parsed)) {
    throw new Error(`${lockfilePath} must contain a JSON object.`);
  }

  const packages = parsed.packages;
  if (!isObject(packages)) {
    throw new Error(`${lockfilePath} must contain a packages object.`);
  }

  const resolved = new Map<string, BunLockPackage>();

  for (const value of Object.values(packages)) {
    const entry = parseBunLockPackageEntry(value);
    if (!entry) continue;

    const parsedResolution = parseResolution(entry.resolution);
    if (!parsedResolution) continue;

    const key = `${parsedResolution.name}@${parsedResolution.version}`;
    if (resolved.has(key)) continue;

    resolved.set(key, {
      integrity: entry.integrity,
      name: parsedResolution.name,
      resolution: entry.resolution,
      version: parsedResolution.version,
    });
  }

  return [...resolved.values()].sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );
}

function hasBlockingSocketAlert(
  result: SocketShallowCheckResult,
  severityThreshold: SocketSeverity,
): boolean {
  return result.alerts.some(
    (alert) => SEVERITY_RANK[alert.severity] >= SEVERITY_RANK[severityThreshold],
  );
}

function formatSocketAlerts(
  result: SocketShallowCheckResult,
  severityThreshold: SocketSeverity,
): string {
  return result.alerts
    .filter((alert) => SEVERITY_RANK[alert.severity] >= SEVERITY_RANK[severityThreshold])
    .map((alert) =>
      [alert.severity, alert.category, alert.title]
        .filter((part) => part && String(part).trim().length > 0)
        .join(":"),
    )
    .join(", ");
}

export async function verifyBunLock(options: {
  readonly concurrency?: number | undefined;
  readonly cwd: string;
  readonly requireSocket?: boolean | undefined;
  readonly socket?: boolean | undefined;
  readonly socketChecker?: SocketShallowChecker | undefined;
  readonly socketSeverityThreshold?: SocketSeverity | undefined;
}): Promise<VerifyLockResult> {
  const lockfilePath = getBunLockfilePath(options.cwd);
  const raw = await readFile(lockfilePath, "utf8");
  const packages = parseBunLockPackages(raw, lockfilePath);
  const socketEnabled = options.socket === true || options.requireSocket === true;
  const socketRequire = options.requireSocket === true;
  const severityThreshold = options.socketSeverityThreshold ?? "high";
  const issues: VerifyLockIssue[] = [];

  for (const pkg of packages) {
    if (!pkg.integrity) {
      issues.push({
        packageName: pkg.name,
        reason: "missingIntegrity",
        severity: "error",
        version: pkg.version,
      });
    }
  }

  if (socketEnabled) {
    const checker = options.socketChecker ?? defaultSocketShallowChecker;

    await pMap(
      packages,
      async (pkg) => {
        const result = await checker({ packageName: pkg.name, version: pkg.version });

        if (!result.ok) {
          if (socketRequire) {
            issues.push({
              packageName: pkg.name,
              reason: `socketUnavailable:${result.unavailableReason ?? "unknown"}`,
              severity: "error",
              version: pkg.version,
            });
          }
          return;
        }

        if (hasBlockingSocketAlert(result, severityThreshold)) {
          issues.push({
            packageName: pkg.name,
            reason: `socketAlert:${formatSocketAlerts(result, severityThreshold)}`,
            severity: "error",
            version: pkg.version,
          });
        }
      },
      { concurrency: options.concurrency ?? 6 },
    );
  }

  const result: VerifyLockResult = {
    checkedPackages: packages.length,
    lockfilePath: resolve(lockfilePath),
    ok: issues.every((issue) => issue.severity !== "error"),
    packages,
    socket: socketEnabled
      ? {
          enabled: true,
          require: socketRequire,
          severityThreshold,
        }
      : undefined,
    issues: issues.sort((left, right) =>
      `${left.packageName}@${left.version}:${left.reason}`.localeCompare(
        `${right.packageName}@${right.version}:${right.reason}`,
      ),
    ),
  };

  return result;
}
