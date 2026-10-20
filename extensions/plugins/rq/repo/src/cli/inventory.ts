import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import { asStringRecord } from "../shared/static-policy";

export type CliHostInventoryEntry = {
  readonly directory: string;
  readonly manifestPath: string;
  readonly packageName: string | null;
  readonly binaryNames: readonly string[];
  readonly hasRemptsDependency: boolean;
  readonly packageIdentityState: "canonical" | "legacy-unsuffixed" | "unexpected";
  readonly remptsHostState: "present" | "missing";
};

export type CliHostInventory = {
  readonly repositoryRoot: string;
  readonly entries: readonly CliHostInventoryEntry[];
  readonly summary: {
    readonly total: number;
    readonly canonicalPackageNames: number;
    readonly legacyUnsuffixedPackageNames: number;
    readonly unexpectedPackageNames: number;
    readonly remptsHosts: number;
    readonly nonRemptsHosts: number;
  };
};

function expectedCliPackageName(directory: string): string {
  return `@reliverse/${directory}-cli`;
}

function legacyCliPackageName(directory: string): string {
  return `@reliverse/${directory}`;
}

export async function inspectCliHostInventory(repositoryRoot: string): Promise<CliHostInventory> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const entries: CliHostInventoryEntry[] = [];

  for (const workspace of index.packages) {
    const match = /^apps\/cli\/([^/]+)\/package\.json$/u.exec(workspace.manifestPath);
    if (!match) continue;
    const directory = match[1]!;
    const packageName = workspace.manifest.name ?? null;
    const dependencies = {
      ...asStringRecord(workspace.manifest.dependencies),
      ...asStringRecord(workspace.manifest.devDependencies),
      ...asStringRecord(workspace.manifest.peerDependencies),
    };
    const bin = asStringRecord(workspace.manifest.bin);

    const packageIdentityState =
      packageName === expectedCliPackageName(directory)
        ? "canonical"
        : packageName === legacyCliPackageName(directory)
          ? "legacy-unsuffixed"
          : "unexpected";

    entries.push({
      directory,
      manifestPath: workspace.manifestPath,
      packageName,
      binaryNames: Object.freeze(Object.keys(bin).sort()),
      hasRemptsDependency: dependencies["@reliverse/rempts"] !== undefined,
      packageIdentityState,
      remptsHostState: dependencies["@reliverse/rempts"] === undefined ? "missing" : "present",
    });
  }

  entries.sort((left, right) => left.directory.localeCompare(right.directory));
  return Object.freeze({
    repositoryRoot: index.repoRoot,
    entries: Object.freeze(entries),
    summary: Object.freeze({
      total: entries.length,
      canonicalPackageNames: entries.filter((entry) => entry.packageIdentityState === "canonical")
        .length,
      legacyUnsuffixedPackageNames: entries.filter(
        (entry) => entry.packageIdentityState === "legacy-unsuffixed",
      ).length,
      unexpectedPackageNames: entries.filter((entry) => entry.packageIdentityState === "unexpected")
        .length,
      remptsHosts: entries.filter((entry) => entry.remptsHostState === "present").length,
      nonRemptsHosts: entries.filter((entry) => entry.remptsHostState === "missing").length,
    }),
  });
}
