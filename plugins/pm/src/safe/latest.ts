export type SocketSeverity = "low" | "medium" | "high" | "critical";

export interface SafeLatestSocketPolicy {
  readonly enabled: boolean;
  readonly require: boolean;
  readonly severityThreshold: SocketSeverity;
}

export interface SafeLatestPolicy {
  readonly allowFreshScopes: readonly string[];
  readonly blockDeprecated: boolean;
  readonly blockInstallScripts: "always" | "unlessAllowlisted" | "warn";
  readonly installScriptAllowlist: readonly string[];
  readonly maxFallbackDepth: number;
  readonly minimumReleaseAgeDays: number;
  readonly socket: SafeLatestSocketPolicy;
}

export type SafeLatestPolicyInput = Partial<Omit<SafeLatestPolicy, "socket">> & {
  readonly socket?: Partial<SafeLatestSocketPolicy> | undefined;
};

export interface SocketAlertSummary {
  readonly category?: string | undefined;
  readonly severity: SocketSeverity;
  readonly title?: string | undefined;
}

export interface SocketShallowCheckResult {
  readonly alerts: readonly SocketAlertSummary[];
  readonly ok: boolean;
  readonly unavailableReason?: string | undefined;
}

export interface SocketShallowChecker {
  (input: {
    readonly packageName: string;
    readonly version: string;
  }): Promise<SocketShallowCheckResult>;
}

export interface SafeVersionDecision {
  readonly accepted?:
    | {
        readonly reasons: readonly string[];
        readonly version: string;
      }
    | undefined;
  readonly minimumReleaseAgeDays: number;
  readonly npmLatest: string;
  readonly packageName: string;
  readonly selected?: string | undefined;
  readonly skipped: readonly {
    readonly reasons: readonly string[];
    readonly version: string;
  }[];
  readonly wanted: "safe-latest";
}

export interface SafeUpdateResolution {
  readonly decision: SafeVersionDecision;
  readonly version: string;
}

export interface RegistryPackageVersionMetadata {
  readonly deprecated?: string | undefined;
  readonly scripts?: Readonly<Record<string, string>> | undefined;
}

export interface SafeLatestPackageMetadata {
  readonly latestVersion: string;
  readonly timeByVersion: Readonly<Record<string, string | undefined>>;
  readonly versionMetadataByVersion: Readonly<
    Record<string, RegistryPackageVersionMetadata | undefined>
  >;
  readonly versions: readonly string[];
}

export const DEFAULT_SAFE_LATEST_SOCKET_POLICY: SafeLatestSocketPolicy = {
  enabled: false,
  require: false,
  severityThreshold: "high",
};

export const DEFAULT_SAFE_LATEST_POLICY: SafeLatestPolicy = {
  allowFreshScopes: ["@reliverse/*"],
  blockDeprecated: true,
  blockInstallScripts: "unlessAllowlisted",
  installScriptAllowlist: [],
  maxFallbackDepth: 20,
  minimumReleaseAgeDays: 7,
  socket: DEFAULT_SAFE_LATEST_SOCKET_POLICY,
};

const INSTALL_SCRIPT_NAMES = new Set(["preinstall", "install", "postinstall", "prepare"]);
const packageMetadataCache = new Map<string, Promise<SafeLatestPackageMetadata>>();
const SEVERITY_RANK: Record<SocketSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function parseSemver(version: string): { prerelease?: string | undefined } | null {
  const match = /^\d+\.\d+\.\d+(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version,
  );

  if (!match) {
    return null;
  }

  return {
    prerelease: match.groups?.prerelease,
  };
}

function matchesScopePattern(packageName: string, pattern: string): boolean {
  const normalizedPattern = pattern.trim();

  if (!normalizedPattern) {
    return false;
  }

  if (normalizedPattern.endsWith("/*")) {
    return packageName.startsWith(normalizedPattern.slice(0, -1));
  }

  return packageName === normalizedPattern;
}

function isFreshPackageAllowed(packageName: string, policy: SafeLatestPolicy): boolean {
  return policy.allowFreshScopes.some((pattern) => matchesScopePattern(packageName, pattern));
}

function getReleaseAgeDays(publishedAt: string | undefined, nowMs: number): number | null {
  if (!publishedAt) {
    return null;
  }

  const publishedTime = Date.parse(publishedAt);

  if (!Number.isFinite(publishedTime)) {
    return null;
  }

  return (nowMs - publishedTime) / 86_400_000;
}

function hasBlockingInstallScript(
  packageName: string,
  versionMetadata: RegistryPackageVersionMetadata | undefined,
  policy: SafeLatestPolicy,
): boolean {
  if (policy.blockInstallScripts === "warn") {
    return false;
  }

  if (
    policy.blockInstallScripts === "unlessAllowlisted" &&
    policy.installScriptAllowlist.some((entry) => entry === packageName)
  ) {
    return false;
  }

  return Object.keys(versionMetadata?.scripts ?? {}).some((scriptName) =>
    INSTALL_SCRIPT_NAMES.has(scriptName),
  );
}

function normalizeSafeLatestPolicy(policy?: SafeLatestPolicyInput): SafeLatestPolicy {
  return {
    ...DEFAULT_SAFE_LATEST_POLICY,
    ...policy,
    allowFreshScopes: policy?.allowFreshScopes ?? DEFAULT_SAFE_LATEST_POLICY.allowFreshScopes,
    installScriptAllowlist:
      policy?.installScriptAllowlist ?? DEFAULT_SAFE_LATEST_POLICY.installScriptAllowlist,
    socket: {
      ...DEFAULT_SAFE_LATEST_SOCKET_POLICY,
      ...(policy?.socket ?? {}),
    },
  };
}

function normalizeSocketSeverity(value: unknown): SocketSeverity | undefined {
  if (value === "middle") return "medium";
  if (value === "low" || value === "medium" || value === "high" || value === "critical") {
    return value;
  }
  return undefined;
}

function shouldBlockSocketAlert(alert: SocketAlertSummary, threshold: SocketSeverity): boolean {
  return SEVERITY_RANK[alert.severity] >= SEVERITY_RANK[threshold];
}

function collectSocketAlerts(value: unknown): SocketAlertSummary[] {
  const alerts: SocketAlertSummary[] = [];
  const seen = new Set<unknown>();

  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const record = node as Record<string, unknown>;
    const severity = normalizeSocketSeverity(record.severity);

    if (severity) {
      alerts.push({
        category:
          typeof record.type === "string"
            ? record.type
            : typeof record.category === "string"
              ? record.category
              : undefined,
        severity,
        title:
          typeof record.title === "string"
            ? record.title
            : typeof record.message === "string"
              ? record.message
              : undefined,
      });
    }

    for (const child of Object.values(record)) visit(child);
  }

  visit(value);
  return alerts;
}

export async function defaultSocketShallowChecker(input: {
  readonly packageName: string;
  readonly version: string;
}): Promise<SocketShallowCheckResult> {
  try {
    const processHandle = Bun.spawn(
      ["socket", "package", "shallow", "npm", `${input.packageName}@${input.version}`, "--json"],
      {
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
      processHandle.exited,
    ]);

    if (exitCode !== 0) {
      return {
        alerts: [],
        ok: false,
        unavailableReason: stderr.trim() || stdout.trim() || `socket CLI exited ${exitCode}`,
      };
    }

    const payload = stdout.trim().length > 0 ? (JSON.parse(stdout) as unknown) : undefined;
    return {
      alerts: collectSocketAlerts(payload),
      ok: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      alerts: [],
      ok: false,
      unavailableReason: message,
    };
  }
}

async function evaluateSocketPolicy(options: {
  readonly checker?: SocketShallowChecker | undefined;
  readonly packageName: string;
  readonly policy: SafeLatestPolicy;
  readonly version: string;
}): Promise<{
  readonly acceptedReasons: readonly string[];
  readonly blockReasons: readonly string[];
}> {
  if (!options.policy.socket.enabled && !options.policy.socket.require) {
    return { acceptedReasons: [], blockReasons: [] };
  }

  const checker = options.checker ?? defaultSocketShallowChecker;
  const result = await checker({ packageName: options.packageName, version: options.version });

  if (!result.ok) {
    const reason = `socketUnavailable:${result.unavailableReason ?? "unknown"}`;
    return options.policy.socket.require
      ? { acceptedReasons: [], blockReasons: [reason] }
      : { acceptedReasons: [reason], blockReasons: [] };
  }

  const blockReasons = result.alerts
    .filter((alert) => shouldBlockSocketAlert(alert, options.policy.socket.severityThreshold))
    .map((alert) =>
      ["socketAlert", alert.severity, alert.category, alert.title]
        .filter((part) => part && String(part).trim().length > 0)
        .join(":"),
    );

  return {
    acceptedReasons: blockReasons.length === 0 ? ["socketShallowOk"] : [],
    blockReasons,
  };
}

export async function resolveSafeLatestFromMetadata(options: {
  readonly metadata: SafeLatestPackageMetadata;
  readonly nowMs?: number | undefined;
  readonly packageName: string;
  readonly policy?: SafeLatestPolicyInput | undefined;
  readonly socketChecker?: SocketShallowChecker | undefined;
}): Promise<SafeUpdateResolution> {
  const policy = normalizeSafeLatestPolicy(options.policy);
  const candidates = options.metadata.versions
    .filter((version) => parseSemver(version)?.prerelease === undefined)
    .slice()
    .sort(Bun.semver.order)
    .reverse()
    .slice(0, policy.maxFallbackDepth);
  const skipped: { reasons: string[]; version: string }[] = [];
  const allowFresh = isFreshPackageAllowed(options.packageName, policy);
  const nowMs = options.nowMs ?? Date.now();

  for (const version of candidates) {
    const versionMetadata = options.metadata.versionMetadataByVersion[version];
    const reasons: string[] = [];
    const releaseAgeDays = getReleaseAgeDays(options.metadata.timeByVersion[version], nowMs);

    if (releaseAgeDays !== null && releaseAgeDays < policy.minimumReleaseAgeDays && !allowFresh) {
      reasons.push(
        `recentlyPublished:${Math.max(0, Math.floor(releaseAgeDays))}d<${policy.minimumReleaseAgeDays}d`,
      );
    }

    if (policy.blockDeprecated && versionMetadata?.deprecated) {
      reasons.push("deprecated");
    }

    if (hasBlockingInstallScript(options.packageName, versionMetadata, policy)) {
      reasons.push("installScript");
    }

    const socketEvaluation =
      reasons.length === 0
        ? await evaluateSocketPolicy({
            checker: options.socketChecker,
            packageName: options.packageName,
            policy,
            version,
          })
        : { acceptedReasons: [], blockReasons: [] };
    reasons.push(...socketEvaluation.blockReasons);

    if (reasons.length > 0) {
      skipped.push({ reasons, version });
      continue;
    }

    const decision: SafeVersionDecision = {
      accepted: {
        reasons: [
          releaseAgeDays === null ? "releaseAgeUnknown" : `age:${Math.floor(releaseAgeDays)}d`,
          "npmMetadataOk",
          ...socketEvaluation.acceptedReasons,
        ],
        version,
      },
      minimumReleaseAgeDays: policy.minimumReleaseAgeDays,
      npmLatest: options.metadata.latestVersion,
      packageName: options.packageName,
      selected: version,
      skipped,
      wanted: "safe-latest",
    };

    return {
      decision,
      version,
    };
  }

  throw new Error(
    `No safe-latest candidate found for "${options.packageName}" after checking ${candidates.length} version(s): ${skipped
      .slice(0, 5)
      .map((item) => `${item.version} (${item.reasons.join(", ")})`)
      .join("; ")}`,
  );
}

async function fetchSafeLatestPackageMetadata(
  packageName: string,
  options?: { readonly refresh?: boolean | undefined },
): Promise<SafeLatestPackageMetadata> {
  if (options?.refresh !== true) {
    const cached = packageMetadataCache.get(packageName);

    if (cached) {
      return cached;
    }
  }

  const request = (async () => {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);

    if (!response.ok) {
      throw new Error(
        `Failed to resolve package metadata for "${packageName}" from npm (${response.status}).`,
      );
    }

    const payload = (await response.json()) as {
      readonly time?: Record<string, string | undefined> | undefined;
      readonly versions?: Record<string, RegistryPackageVersionMetadata | undefined> | undefined;
      readonly "dist-tags"?: { readonly latest?: string | undefined } | undefined;
    };
    const latestVersion = payload["dist-tags"]?.latest;

    if (!latestVersion) {
      throw new Error(`Registry metadata for "${packageName}" did not include dist-tags.latest.`);
    }

    return {
      latestVersion,
      timeByVersion: payload.time ?? {},
      versionMetadataByVersion: payload.versions ?? {},
      versions: Object.keys(payload.versions ?? {}).sort(Bun.semver.order),
    };
  })();

  if (options?.refresh !== true) {
    packageMetadataCache.set(packageName, request);
  }

  return request;
}

export async function resolveSafeLatestVersion(options: {
  readonly currentSpecifier: string;
  readonly packageName: string;
  readonly policy?: SafeLatestPolicyInput | undefined;
  readonly refresh?: boolean | undefined;
  readonly socketChecker?: SocketShallowChecker | undefined;
}): Promise<SafeUpdateResolution> {
  const metadata = await fetchSafeLatestPackageMetadata(options.packageName, {
    refresh: options.refresh,
  });

  return resolveSafeLatestFromMetadata({
    metadata,
    packageName: options.packageName,
    policy: options.policy,
    socketChecker: options.socketChecker,
  });
}
