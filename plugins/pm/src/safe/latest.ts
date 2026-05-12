export interface SafeLatestPolicy {
  readonly allowFreshScopes: readonly string[];
  readonly blockDeprecated: boolean;
  readonly blockInstallScripts: "always" | "unlessAllowlisted" | "warn";
  readonly installScriptAllowlist: readonly string[];
  readonly maxFallbackDepth: number;
  readonly minimumReleaseAgeDays: number;
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

export const DEFAULT_SAFE_LATEST_POLICY: SafeLatestPolicy = {
  allowFreshScopes: ["@reliverse/*"],
  blockDeprecated: true,
  blockInstallScripts: "unlessAllowlisted",
  installScriptAllowlist: [],
  maxFallbackDepth: 20,
  minimumReleaseAgeDays: 7,
};

const INSTALL_SCRIPT_NAMES = new Set(["preinstall", "install", "postinstall", "prepare"]);
const packageMetadataCache = new Map<string, Promise<SafeLatestPackageMetadata>>();

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

function normalizeSafeLatestPolicy(policy?: Partial<SafeLatestPolicy>): SafeLatestPolicy {
  return {
    ...DEFAULT_SAFE_LATEST_POLICY,
    ...policy,
    allowFreshScopes: policy?.allowFreshScopes ?? DEFAULT_SAFE_LATEST_POLICY.allowFreshScopes,
    installScriptAllowlist:
      policy?.installScriptAllowlist ?? DEFAULT_SAFE_LATEST_POLICY.installScriptAllowlist,
  };
}

export function resolveSafeLatestFromMetadata(options: {
  readonly metadata: SafeLatestPackageMetadata;
  readonly nowMs?: number | undefined;
  readonly packageName: string;
  readonly policy?: Partial<SafeLatestPolicy> | undefined;
}): SafeUpdateResolution {
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

    if (reasons.length > 0) {
      skipped.push({ reasons, version });
      continue;
    }

    const decision: SafeVersionDecision = {
      accepted: {
        reasons: [
          releaseAgeDays === null ? "releaseAgeUnknown" : `age:${Math.floor(releaseAgeDays)}d`,
          "npmMetadataOk",
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
  readonly policy?: Partial<SafeLatestPolicy> | undefined;
  readonly refresh?: boolean | undefined;
}): Promise<SafeUpdateResolution> {
  const metadata = await fetchSafeLatestPackageMetadata(options.packageName, {
    refresh: options.refresh,
  });

  return resolveSafeLatestFromMetadata({
    metadata,
    packageName: options.packageName,
    policy: options.policy,
  });
}
