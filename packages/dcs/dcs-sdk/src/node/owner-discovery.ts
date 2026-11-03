import { stat } from "node:fs/promises";
import path from "node:path";

export const DCS_DISCOVERY_FORMATS = ["json", "jsonc", "yaml", "ts"] as const;
export type DcsDiscoveryFormat = (typeof DCS_DISCOVERY_FORMATS)[number];
export type DcsDiscoveryKind = "main" | "profile" | "schema";
export type DcsDiscoveryScope = "package" | "repository" | "user";
export type DcsDiscoveryLayout = "directory" | "root" | "explicit";

export interface DcsOwnerRegistration {
  readonly aliases?: readonly string[];
  readonly basename: string;
  readonly formats?: readonly DcsDiscoveryFormat[];
  readonly generation?: {
    readonly defaultFormat?: DcsDiscoveryFormat;
    readonly defaultLayout?: Exclude<DcsDiscoveryLayout, "explicit">;
    readonly directoryIncludesConfigSegment?: boolean;
    readonly rootIncludesConfigSegment?: boolean;
  };
  readonly owner: string;
  readonly profiles?: readonly string[];
  readonly schemaAliases?: readonly string[];
}

export interface DefinedDcsOwner {
  readonly aliases: readonly string[];
  readonly basename: string;
  readonly formats: readonly DcsDiscoveryFormat[];
  readonly generation: {
    readonly defaultFormat: DcsDiscoveryFormat;
    readonly defaultLayout: Exclude<DcsDiscoveryLayout, "explicit">;
    readonly directoryIncludesConfigSegment: boolean;
    readonly rootIncludesConfigSegment: boolean;
  };
  readonly owner: string;
  readonly profiles: readonly string[];
  readonly schemaAliases: readonly string[];
}

export interface DcsDiscoveryScopeRoot {
  readonly root: string;
  readonly scope: DcsDiscoveryScope;
  /** A resolved user/private product root uses config.json and schema.json. */
  readonly layout?: "product";
}

export interface DcsDiscoveryCandidate {
  readonly basename: string;
  readonly format: DcsDiscoveryFormat;
  readonly kind: DcsDiscoveryKind;
  readonly layout: DcsDiscoveryLayout;
  readonly path: string;
  readonly profile?: string;
  readonly provenance: "explicit" | "implicit";
  readonly scope: DcsDiscoveryScope;
  readonly trustedCode: boolean;
}

export interface DcsDiscoveryDiagnostic {
  readonly code:
    | "DCS_CONFIG_AMBIGUOUS"
    | "DCS_DUPLICATE_SCHEMA_PROJECTION"
    | "DCS_EXPLICIT_CONFIG_MISSING"
    | "DCS_OWNER_INVALID"
    | "DCS_TS_CONFIG_TRUST_REQUIRED"
    | "DCS_UNSUPPORTED_CONFIG_FORMAT";
  readonly message: string;
  readonly paths: readonly string[];
  readonly severity: "error" | "warning";
}

export interface DiscoverDcsOwnerConfigOptions {
  readonly allowTrustedTypeScript?: boolean;
  readonly explicitPath?: string;
  readonly owner: DefinedDcsOwner;
  readonly scopes: readonly DcsDiscoveryScopeRoot[];
}

export interface DcsOwnerDiscoveryPlan {
  readonly active?: DcsDiscoveryCandidate;
  readonly activeSchema?: DcsDiscoveryCandidate;
  readonly candidates: readonly DcsDiscoveryCandidate[];
  readonly canonicalPathByScope: Readonly<Partial<Record<DcsDiscoveryScope, string>>>;
  readonly canonicalSchemaPathByScope: Readonly<Partial<Record<DcsDiscoveryScope, string>>>;
  readonly diagnostics: readonly DcsDiscoveryDiagnostic[];
  readonly explicit: boolean;
  readonly mainCandidates: readonly DcsDiscoveryCandidate[];
  readonly ok: boolean;
  readonly owner: DefinedDcsOwner;
  readonly profiles: readonly DcsDiscoveryCandidate[];
  readonly schemas: readonly DcsDiscoveryCandidate[];
}

const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const PROFILE_PATTERN = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/u;

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function defineDcsOwner(input: DcsOwnerRegistration): DefinedDcsOwner {
  const aliases = unique(input.aliases ?? []);
  const formats = unique(input.formats ?? DCS_DISCOVERY_FORMATS);
  const profiles = unique(input.profiles ?? []);
  const invalid = [input.owner, input.basename, ...aliases].find(
    (value) => !ID_PATTERN.test(value),
  );
  if (invalid)
    throw new Error(`DCS_OWNER_INVALID: Invalid DCS owner or basename ${JSON.stringify(invalid)}.`);
  const invalidProfile = profiles.find((value) => !PROFILE_PATTERN.test(value));
  if (invalidProfile)
    throw new Error(`DCS_OWNER_INVALID: Invalid DCS profile ${JSON.stringify(invalidProfile)}.`);
  if (formats.length === 0)
    throw new Error("DCS_OWNER_INVALID: At least one config format is required.");

  const defaultFormat = input.generation?.defaultFormat ?? "json";
  if (!formats.includes(defaultFormat)) {
    throw new Error(`DCS_OWNER_INVALID: Default format ${defaultFormat} is not registered.`);
  }

  return Object.freeze({
    aliases: Object.freeze(aliases),
    basename: input.basename,
    formats: Object.freeze(formats),
    generation: Object.freeze({
      defaultFormat,
      defaultLayout: input.generation?.defaultLayout ?? "directory",
      directoryIncludesConfigSegment: input.generation?.directoryIncludesConfigSegment ?? false,
      rootIncludesConfigSegment: input.generation?.rootIncludesConfigSegment ?? true,
    }),
    owner: input.owner,
    profiles: Object.freeze(profiles),
    schemaAliases: Object.freeze(unique(input.schemaAliases ?? [])),
  });
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

function canonicalPath(owner: DefinedDcsOwner, root: string): string {
  const generation = owner.generation;
  const segment =
    generation.defaultLayout === "directory"
      ? generation.directoryIncludesConfigSegment
        ? ".config"
        : ""
      : generation.rootIncludesConfigSegment
        ? ".config"
        : "";
  const filename = `${owner.basename}${segment}.${generation.defaultFormat}`;
  return generation.defaultLayout === "directory"
    ? path.join(root, ".config", filename)
    : path.join(root, filename);
}

function canonicalSchemaPath(owner: DefinedDcsOwner, root: string): string {
  return owner.generation.defaultLayout === "directory"
    ? path.join(root, ".config", "schema", `${owner.basename}.json`)
    : path.join(root, `${owner.basename}.schema.json`);
}

function candidate(
  owner: DefinedDcsOwner,
  scope: DcsDiscoveryScope,
  candidatePath: string,
  kind: DcsDiscoveryKind,
  layout: DcsDiscoveryLayout,
  format: DcsDiscoveryFormat,
  profile?: string,
): DcsDiscoveryCandidate {
  return Object.freeze({
    basename: owner.basename,
    format,
    kind,
    layout,
    path: path.resolve(candidatePath),
    ...(profile === undefined ? {} : { profile }),
    provenance: layout === "explicit" ? "explicit" : "implicit",
    scope,
    trustedCode: format === "ts",
  });
}

function formatFromPath(candidatePath: string): DcsDiscoveryFormat | undefined {
  const extension = path.extname(candidatePath).slice(1);
  return (DCS_DISCOVERY_FORMATS as readonly string[]).includes(extension)
    ? (extension as DcsDiscoveryFormat)
    : undefined;
}

async function discoverScope(
  owner: DefinedDcsOwner,
  input: DcsDiscoveryScopeRoot,
): Promise<DcsDiscoveryCandidate[]> {
  const found: DcsDiscoveryCandidate[] = [];
  if (input.layout === "product") {
    for (const format of owner.formats) {
      const mainPath = path.join(input.root, `config.${format}`);
      if (await isFile(mainPath)) found.push(candidate(owner, input.scope, mainPath, "main", "root", format));
      for (const profile of owner.profiles) {
        const profilePath = path.join(input.root, `config.${profile}.${format}`);
        if (await isFile(profilePath)) found.push(candidate(owner, input.scope, profilePath, "profile", "root", format, profile));
      }
    }
    const schemaPath = path.join(input.root, "schema.json");
    if (await isFile(schemaPath)) found.push(candidate(owner, input.scope, schemaPath, "schema", "root", "json"));
    return found;
  }
  const basenames = [owner.basename, ...owner.aliases];
  for (const basename of basenames) {
    for (const format of owner.formats) {
      for (const [layout, directory] of [
        ["directory", path.join(input.root, ".config")],
        ["root", input.root],
      ] as const) {
        for (const segment of ["", ".config"] as const) {
          const mainPath = path.join(directory, `${basename}${segment}.${format}`);
          if (await isFile(mainPath))
            found.push(candidate(owner, input.scope, mainPath, "main", layout, format));
        }
        for (const profile of owner.profiles) {
          const profilePath = path.join(directory, `${basename}.${profile}.${format}`);
          if (await isFile(profilePath))
            found.push(
              candidate(owner, input.scope, profilePath, "profile", layout, format, profile),
            );
        }
      }
    }
  }

  const schemaPaths = new Set<string>([
    path.join(input.root, ".config", "schema", `${owner.basename}.json`),
    path.join(input.root, ".config", `${owner.basename}.schema.json`),
    path.join(input.root, ".config", "schemas", `${owner.basename}.json`),
    path.join(input.root, ".config", "schemas", `${owner.basename}.schema.json`),
    path.join(input.root, `${owner.basename}.schema.json`),
    ...owner.schemaAliases.map((value) => path.resolve(input.root, value)),
  ]);
  for (const schemaPath of schemaPaths) {
    if (await isFile(schemaPath)) {
      found.push(
        candidate(
          owner,
          input.scope,
          schemaPath,
          "schema",
          schemaPath.includes(`${path.sep}.config${path.sep}`) ? "directory" : "root",
          "json",
        ),
      );
    }
  }
  return found;
}

export async function discoverDcsOwnerConfig(
  options: DiscoverDcsOwnerConfigOptions,
): Promise<DcsOwnerDiscoveryPlan> {
  const diagnostics: DcsDiscoveryDiagnostic[] = [];
  const canonicalPathByScope: Partial<Record<DcsDiscoveryScope, string>> = {};
  const canonicalSchemaPathByScope: Partial<Record<DcsDiscoveryScope, string>> = {};
  const candidates: DcsDiscoveryCandidate[] = [];
  for (const scope of options.scopes) {
    canonicalPathByScope[scope.scope] = scope.layout === "product" ? path.join(scope.root, `config.${options.owner.generation.defaultFormat}`) : canonicalPath(options.owner, scope.root);
    canonicalSchemaPathByScope[scope.scope] = scope.layout === "product" ? path.join(scope.root, "schema.json") : canonicalSchemaPath(options.owner, scope.root);
    candidates.push(...(await discoverScope(options.owner, scope)));
  }
  candidates.sort((left, right) => left.path.localeCompare(right.path));

  const implicitMain = candidates.filter((entry) => entry.kind === "main");
  for (const scope of options.scopes) {
    const competing = implicitMain.filter((entry) => entry.scope === scope.scope);
    if (competing.length > 1) {
      diagnostics.push({
        code: "DCS_CONFIG_AMBIGUOUS",
        message: `Multiple implicit main configurations were found for ${options.owner.owner} in ${scope.scope} scope. Keep exactly one; canonical path: ${canonicalPathByScope[scope.scope]}.`,
        paths: competing.map((entry) => entry.path),
        severity: "error",
      });
    }
    const schemas = candidates.filter(
      (entry) => entry.kind === "schema" && entry.scope === scope.scope,
    );
    if (schemas.length > 1) {
      diagnostics.push({
        code: "DCS_DUPLICATE_SCHEMA_PROJECTION",
        message: `Multiple schema projections were found for ${options.owner.owner} in ${scope.scope} scope. Keep exactly one; canonical path: ${canonicalSchemaPathByScope[scope.scope]}.`,
        paths: schemas.map((entry) => entry.path),
        severity: "error",
      });
    }
  }

  const schemaCandidates = candidates.filter((entry) => entry.kind === "schema");
  const activeSchema = diagnostics.some((entry) => entry.code === "DCS_DUPLICATE_SCHEMA_PROJECTION")
    ? undefined
    : schemaCandidates[0];

  let active: DcsDiscoveryCandidate | undefined;
  if (options.explicitPath) {
    const explicitPath = path.resolve(options.explicitPath);
    const format = formatFromPath(explicitPath);
    if (!format || !options.owner.formats.includes(format)) {
      diagnostics.push({
        code: "DCS_UNSUPPORTED_CONFIG_FORMAT",
        message: `Explicit config path uses an unsupported format for ${options.owner.owner}.`,
        paths: [explicitPath],
        severity: "error",
      });
    } else if (!(await isFile(explicitPath))) {
      diagnostics.push({
        code: "DCS_EXPLICIT_CONFIG_MISSING",
        message: `Explicit config path does not exist for ${options.owner.owner}.`,
        paths: [explicitPath],
        severity: "error",
      });
    } else {
      const matchingScope = [...options.scopes]
        .sort((left, right) => path.resolve(right.root).length - path.resolve(left.root).length)
        .find(
          (entry) =>
            explicitPath === path.resolve(entry.root) ||
            explicitPath.startsWith(`${path.resolve(entry.root)}${path.sep}`),
        );
      active = candidate(
        options.owner,
        matchingScope?.scope ?? "repository",
        explicitPath,
        "main",
        "explicit",
        format,
      );
    }
  } else if (!diagnostics.some((entry) => entry.code === "DCS_CONFIG_AMBIGUOUS")) {
    active = [...implicitMain].sort((left, right) => {
      const rank: Record<DcsDiscoveryScope, number> = { package: 0, repository: 1, user: 2 };
      return rank[left.scope] - rank[right.scope] || left.path.localeCompare(right.path);
    })[0];
  }

  if (active?.trustedCode && options.allowTrustedTypeScript !== true) {
    diagnostics.push({
      code: "DCS_TS_CONFIG_TRUST_REQUIRED",
      message: `TypeScript config ${active.path} is trusted executable code. Discovery did not execute it; loading requires an explicit trusted loader boundary.`,
      paths: [active.path],
      severity: "error",
    });
  }

  return Object.freeze({
    ...(active === undefined ? {} : { active }),
    ...(activeSchema === undefined ? {} : { activeSchema }),
    candidates: Object.freeze(candidates),
    canonicalPathByScope: Object.freeze(canonicalPathByScope),
    canonicalSchemaPathByScope: Object.freeze(canonicalSchemaPathByScope),
    diagnostics: Object.freeze(diagnostics),
    explicit: options.explicitPath !== undefined,
    mainCandidates: Object.freeze(implicitMain),
    ok: !diagnostics.some((entry) => entry.severity === "error"),
    owner: options.owner,
    profiles: Object.freeze(candidates.filter((entry) => entry.kind === "profile")),
    schemas: Object.freeze(schemaCandidates),
  });
}
