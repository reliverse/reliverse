export type GtbOptionalMode = "matching" | "all" | "none";

export type GtbResolvedAlias = {
  inputPackageName: string;
  packageName: string;
  aliasName: string;
  description: string;
};

export type GtbOptions = {
  packageName: string;
  inputPackageName: string;
  tag: string;
  version?: string;
  os: string;
  arch: string;
  outputDir: string;
  includeOptional: boolean;
  optionalMode: GtbOptionalMode;
  npmBin: string;
  overwrite: boolean;
  aliased: boolean;
  alias?: GtbResolvedAlias;
  apply: boolean;
  json: boolean;
};

export type GtbRawOptionsInput = {
  args: unknown;
  options: Record<string, unknown>;
  apply: boolean;
};

export type GtbNpmPackageInfo = {
  name: string;
  version: string;
  optionalDependencies: Record<string, string>;
};

export type GtbPackagePlanItemKind = "root" | "optional";

export type GtbPackagePlanItem = {
  kind: GtbPackagePlanItemKind;
  name: string;
  requestedSpec: string;
  resolvedSpec: string;
  version: string;
  optionalDependencyRange?: string;
  outputFilename: string;
  outputPath: string;
  matchedPlatform?: boolean;
};

export type GtbNpmPackResult = {
  id?: string;
  name?: string;
  version?: string;
  filename?: string;
  files?: Array<{
    path: string;
    size: number;
    mode: number;
  }>;
  bundled?: unknown[];
  size?: number;
  unpackedSize?: number;
  shasum?: string;
  integrity?: string;
};

export type GtbRunResult = {
  ok: boolean;
  apply: boolean;
  packageName: string;
  inputPackageName: string;
  requestedSpec: string;
  resolvedRoot: GtbNpmPackageInfo;
  os: string;
  arch: string;
  outputDir: string;
  optionalMode: GtbOptionalMode;
  aliased: boolean;
  alias?: GtbResolvedAlias;
  plan: GtbPackagePlanItem[];
  packed: Array<{
    plan: GtbPackagePlanItem;
    npm: GtbNpmPackResult | null;
  }>;
  skipped: Array<{
    name: string;
    reason: string;
  }>;
  commands: string[];
};
