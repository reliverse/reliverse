import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import process from "node:process";

import {
  canonicalizeJson,
  explainConfigPath,
  isDcsProfileName,
  parseConfigDocument,
  resolveConfigLayers,
  sha256Hex,
  type DcsConfigLayerSource,
  type DcsDiagnostic,
  type DcsDocumentSyntax,
  type DcsExtensionRegistry,
  type DcsFieldProvenance,
  type DcsProfileName,
  type DcsResolvedConfig,
  type DcsResolutionLayer,
  type ConfigContractBundle,
  type JsonObject,
} from "@reliverse/dcs-contract";

export type DcsReferencePlatform = "darwin" | "linux" | "win32";

export interface CanonicalConfigPaths {
  readonly local: string;
  readonly user: string;
  readonly workspace: string;
}

export interface CanonicalConfigPathVariants {
  readonly json: CanonicalConfigPaths;
  readonly jsonc: CanonicalConfigPaths;
}

export interface DiscoverConfigDocumentsOptions {
  readonly bundle: ConfigContractBundle;
  /** Explicit host-owned scope projections; never inferred from an executable or config filename. */
  readonly locations?: CanonicalConfigPathVariants;
  /** Locally resolved extension descriptors. DCS never fetches registry data. */
  readonly extensionRegistry?: DcsExtensionRegistry;
  /** Host-side registry-loading diagnostics to surface beside document diagnostics. */
  readonly extensionRegistryDiagnostics?: readonly DcsDiagnostic[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Internal host control: exclude only selected profile overlays for a scope. */
  readonly excludeProfileScopes?: readonly ("local" | "user" | "workspace")[];
  /** Force one syntax. Omit to auto-discover one JSON or JSONC document per scope. */
  readonly format?: DcsDocumentSyntax;
  readonly homeDir?: string;
  readonly includeLocal?: boolean;
  readonly includeUser?: boolean;
  readonly includeWorkspace?: boolean;
  /** Explicit profile overlay. DCS never infers a profile from environment or host state. */
  readonly profile?: DcsProfileName;
  readonly platform?: DcsReferencePlatform;
  readonly workspaceRoot: string;
}

export interface DiscoveredConfigDocument {
  readonly format: DcsDocumentSyntax;
  readonly layer: DcsResolutionLayer;
  readonly location: string;
  readonly profile?: DcsProfileName;
}

export interface DcsDiscoveredProfile {
  readonly locations: CanonicalConfigPaths;
  readonly name: DcsProfileName;
  readonly variants: CanonicalConfigPathVariants;
}

export interface DiscoverConfigDocumentsResult {
  readonly diagnostics: readonly DcsDiagnostic[];
  readonly documents: readonly DiscoveredConfigDocument[];
  readonly locations: CanonicalConfigPaths;
  readonly ok: boolean;
  readonly profile?: DcsDiscoveredProfile;
  readonly variants: CanonicalConfigPathVariants;
}

export interface ResolveConfigOptions extends DiscoverConfigDocumentsOptions {
  readonly invocation?: JsonObject | string;
}

export interface ResolveConfigResult {
  readonly diagnostics: readonly DcsDiagnostic[];
  readonly discovery: DiscoverConfigDocumentsResult;
  /** Hash of effective values plus opaque extension layers, not source formatting. */
  readonly effectiveRevision?: string;
  readonly ok: boolean;
  readonly resolved?: DcsResolvedConfig;
}

export interface ExplainConfigOptions extends ResolveConfigOptions {
  readonly path: string;
}

export interface ExplainConfigResult extends ResolveConfigResult {
  readonly explanation?: DcsFieldProvenance;
}

/** Base-document locations. JSON remains the portable default. */
export function locateConfig(options: DiscoverConfigDocumentsOptions): CanonicalConfigPaths {
  return locateConfigVariants(options)[options.format ?? "json"];
}

export function locateConfigVariants(
  options: DiscoverConfigDocumentsOptions,
): CanonicalConfigPathVariants {
  return buildLocationVariants(options, undefined);
}

/** Explicit profile-overlay locations. These are never selected implicitly. */
export function locateProfileConfig(
  options: DiscoverConfigDocumentsOptions,
  profile = options.profile,
): CanonicalConfigPaths {
  return locateProfileConfigVariants(options, profile)[options.format ?? "json"];
}

export function locateProfileConfigVariants(
  options: DiscoverConfigDocumentsOptions,
  profile = options.profile,
): CanonicalConfigPathVariants {
  if (profile === undefined || !isDcsProfileName(profile)) {
    throw new TypeError("DCS profile locations require a valid explicit profile name.");
  }
  return buildLocationVariants(options, profile);
}

export async function discoverConfigDocuments(
  options: DiscoverConfigDocumentsOptions,
): Promise<DiscoverConfigDocumentsResult> {
  if (options.profile !== undefined && !isDcsProfileName(options.profile)) {
    return Object.freeze({
      diagnostics: Object.freeze([
        diagnostic("DCS3201", `Invalid explicit profile ${JSON.stringify(options.profile)}.`),
      ]),
      documents: Object.freeze([]),
      locations: locateConfig(options),
      ok: false,
      variants: locateConfigVariants(options),
    });
  }

  const variants = locateConfigVariants(options);
  const locations = locateConfig(options);
  const profileVariants =
    options.profile === undefined
      ? undefined
      : locateProfileConfigVariants(options, options.profile);
  const profileLocations =
    profileVariants === undefined ? undefined : profileVariants[options.format ?? "json"];
  const diagnostics: DcsDiagnostic[] = [...(options.extensionRegistryDiagnostics ?? [])];
  const documents: DiscoveredConfigDocument[] = [];
  const scopes: Array<"local" | "user" | "workspace"> = ["user", "workspace", "local"];

  for (const scope of scopes) {
    if (!includeScope(options, scope)) {
      continue;
    }
    await discoverOne({
      bundle: options.bundle,
      diagnostics,
      documents,
      ...(options.extensionRegistry === undefined
        ? {}
        : { extensionRegistry: options.extensionRegistry }),
      formats: options.format === undefined ? ["jsonc", "json"] : [options.format],
      locations: variants,
      scope,
    });
    if (
      options.profile !== undefined &&
      profileVariants !== undefined &&
      !options.excludeProfileScopes?.includes(scope)
    ) {
      await discoverOne({
        bundle: options.bundle,
        diagnostics,
        documents,
        ...(options.extensionRegistry === undefined
          ? {}
          : { extensionRegistry: options.extensionRegistry }),
        formats: options.format === undefined ? ["jsonc", "json"] : [options.format],
        locations: profileVariants,
        profile: options.profile,
        scope,
      });
    }
  }

  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    documents: Object.freeze(documents),
    locations,
    ok: !diagnostics.some((entry) => entry.severity === "error"),
    ...(options.profile === undefined ||
    profileLocations === undefined ||
    profileVariants === undefined
      ? {}
      : {
          profile: Object.freeze({
            locations: profileLocations,
            name: options.profile,
            variants: profileVariants,
          }),
        }),
    variants,
  });
}

export async function resolveConfig(options: ResolveConfigOptions): Promise<ResolveConfigResult> {
  const discovery = await discoverConfigDocuments(options);
  const diagnostics: DcsDiagnostic[] = [...discovery.diagnostics];
  const layers = discovery.documents.map((document) => document.layer);

  if (options.invocation !== undefined) {
    const source: DcsConfigLayerSource = { kind: "invocation-override" };
    const parsed = parseConfigDocument(options.invocation, {
      bundle: options.bundle,
      ...(options.extensionRegistry === undefined
        ? {}
        : { extensionRegistry: options.extensionRegistry }),
      scope: "invocation",
    });
    diagnostics.push(...parsed.diagnostics.map((entry) => withSource(entry, source)));

    if (parsed.document !== undefined) {
      layers.push({ document: parsed.document, scope: "invocation", source });
    }
  }

  if (diagnostics.some((entry) => entry.severity === "error")) {
    return { diagnostics, discovery, ok: false };
  }

  const resolution = resolveConfigLayers({ bundle: options.bundle, layers });
  diagnostics.push(...resolution.diagnostics);

  const resolved = resolution.resolved;
  return {
    diagnostics,
    discovery,
    ...(resolved === undefined
      ? {}
      : {
          effectiveRevision: await effectiveConfigRevision(resolved),
          resolved,
        }),
    ok: resolution.ok,
  };
}

/** Library-level equivalent of `dcs validate`. */
export async function validateConfig(
  options: ResolveConfigOptions,
): Promise<Pick<ResolveConfigResult, "diagnostics" | "discovery" | "effectiveRevision" | "ok">> {
  const result = await resolveConfig(options);
  return {
    diagnostics: result.diagnostics,
    discovery: result.discovery,
    ...(result.effectiveRevision === undefined
      ? {}
      : { effectiveRevision: result.effectiveRevision }),
    ok: result.ok,
  };
}

/** Library-level equivalent of `dcs explain <pointer>`. */
export async function explainConfig(options: ExplainConfigOptions): Promise<ExplainConfigResult> {
  const result = await resolveConfig(options);
  const explanation =
    result.resolved === undefined ? undefined : explainConfigPath(result.resolved, options.path);
  return {
    ...result,
    ...(explanation === undefined ? {} : { explanation }),
  };
}

export async function effectiveConfigRevision(resolved: DcsResolvedConfig): Promise<string> {
  const extensions = resolved.extensions.map((entry) => entry.extensions);
  const payload: JsonObject = { extensions, value: resolved.value };
  return `sha256:${await sha256Hex(`dcs-effective-v0\u0000${canonicalizeJson(payload)}`)}`;
}

async function discoverOne(input: {
  readonly bundle: ConfigContractBundle;
  readonly diagnostics: DcsDiagnostic[];
  readonly documents: DiscoveredConfigDocument[];
  readonly extensionRegistry?: DcsExtensionRegistry;
  readonly formats: readonly DcsDocumentSyntax[];
  readonly locations: CanonicalConfigPathVariants;
  readonly profile?: DcsProfileName;
  readonly scope: "local" | "user" | "workspace";
}): Promise<void> {
  const selection = await selectDocumentVariant({
    formats: input.formats,
    locations: input.locations,
    ...(input.profile === undefined ? {} : { profile: input.profile }),
    scope: input.scope,
  });
  const source = sourceFor(input.scope, input.profile);
  if (selection.kind === "missing") {
    return;
  }
  if (selection.kind === "error") {
    input.diagnostics.push(withSource(diagnostic(selection.code, selection.message), source));
    return;
  }
  const sourceWithLocation = Object.freeze({ ...source, location: selection.location });
  const parsed = parseConfigDocument(selection.text, {
    bundle: input.bundle,
    ...(input.extensionRegistry === undefined
      ? {}
      : { extensionRegistry: input.extensionRegistry }),
    ...(input.profile === undefined ? {} : { profile: input.profile }),
    scope: input.scope,
    syntax: selection.format,
  });
  input.diagnostics.push(
    ...parsed.diagnostics.map((entry) => withSource(entry, sourceWithLocation)),
  );
  if (parsed.document === undefined) {
    return;
  }
  input.documents.push(
    Object.freeze({
      format: selection.format,
      layer: Object.freeze({
        document: parsed.document,
        ...(input.profile === undefined ? {} : { profile: input.profile }),
        scope: input.scope,
        source: sourceWithLocation,
      }),
      location: selection.location,
      ...(input.profile === undefined ? {} : { profile: input.profile }),
    }),
  );
}

function includeScope(
  options: DiscoverConfigDocumentsOptions,
  scope: "local" | "user" | "workspace",
): boolean {
  return scope === "local"
    ? options.includeLocal !== false
    : scope === "user"
      ? options.includeUser !== false
      : options.includeWorkspace !== false;
}

function buildLocationVariants(
  options: DiscoverConfigDocumentsOptions,
  profile: DcsProfileName | undefined,
): CanonicalConfigPathVariants {
  if (options.locations !== undefined) {
    if (profile !== undefined)
      throw new TypeError("Explicit scope projections require explicit profile locations.");
    for (const locations of Object.values(options.locations)) {
      for (const location of Object.values(locations)) {
        if (typeof location !== "string" || !path.isAbsolute(location))
          throw new TypeError("DCS host scope locations must be absolute.");
      }
    }
    return options.locations;
  }
  const platform = resolvePlatform(options.platform);
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;
  const workspaceRoot = pathApi.resolve(options.workspaceRoot);
  const fileStem = options.bundle.$dcs.fileStem;
  const userDirectory = userConfigDirectory({ env, homeDir, pathApi, platform });
  const suffix = profile === undefined ? "" : `.${profile}`;

  const build = (format: DcsDocumentSyntax): CanonicalConfigPaths => {
    const extension = format === "jsonc" ? ".jsonc" : ".json";
    return Object.freeze({
      local: pathApi.join(workspaceRoot, `.${fileStem}`, `config.local${suffix}${extension}`),
      user: pathApi.join(userDirectory, fileStem, `config${suffix}${extension}`),
      workspace: pathApi.join(workspaceRoot, `${fileStem}.config${suffix}${extension}`),
    });
  };
  return Object.freeze({ json: build("json"), jsonc: build("jsonc") });
}

function sourceFor(
  scope: "local" | "user" | "workspace",
  profile: DcsProfileName | undefined,
): DcsConfigLayerSource {
  const kind =
    profile === undefined
      ? scope === "local"
        ? "local-document"
        : scope === "user"
          ? "user-document"
          : "workspace-document"
      : scope === "local"
        ? "local-profile-document"
        : scope === "user"
          ? "user-profile-document"
          : "workspace-profile-document";
  return Object.freeze({ kind, ...(profile === undefined ? {} : { profile }) });
}

async function selectDocumentVariant(input: {
  readonly formats: readonly DcsDocumentSyntax[];
  readonly locations: CanonicalConfigPathVariants;
  readonly profile?: DcsProfileName;
  readonly scope: "local" | "user" | "workspace";
}): Promise<
  | { readonly kind: "missing" }
  | { readonly code: string; readonly kind: "error"; readonly message: string }
  | {
      readonly format: DcsDocumentSyntax;
      readonly kind: "value";
      readonly location: string;
      readonly text: string;
    }
> {
  const found: Array<{
    readonly format: DcsDocumentSyntax;
    readonly location: string;
    readonly text: string;
  }> = [];
  for (const format of input.formats) {
    const location = input.locations[format][input.scope];
    const read = await readCanonicalDocument(location);
    if (read.kind === "missing") continue;
    if (read.kind === "error") {
      return {
        code: "DCS2020",
        kind: "error",
        message: `Unable to read configuration document: ${read.message}`,
      };
    }
    found.push({ format, location, text: read.value });
  }
  if (found.length === 0) return { kind: "missing" };
  if (found.length > 1) {
    return {
      code: "DCS2021",
      kind: "error",
      message: `Both JSON and JSONC documents exist for ${input.profile === undefined ? "base" : `profile ${JSON.stringify(input.profile)}`} ${input.scope} scope. Select one syntax explicitly or remove the duplicate.`,
    };
  }
  return { ...found[0]!, kind: "value" };
}

async function readCanonicalDocument(
  location: string,
): Promise<
  | { readonly kind: "missing" }
  | { readonly kind: "value"; readonly value: string }
  | { readonly kind: "error"; readonly message: string }
> {
  try {
    return { kind: "value", value: await readFile(location, "utf8") };
  } catch (error) {
    if (isMissingFileError(error)) return { kind: "missing" };
    return {
      kind: "error",
      message: error instanceof Error ? error.message : "Unknown filesystem error.",
    };
  }
}

function userConfigDirectory(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDir: string;
  readonly pathApi: typeof path.posix | typeof path.win32;
  readonly platform: DcsReferencePlatform;
}): string {
  switch (input.platform) {
    case "darwin":
      return input.pathApi.join(input.homeDir, "Library", "Application Support");
    case "linux":
      return input.env.XDG_CONFIG_HOME === undefined || input.env.XDG_CONFIG_HOME.length === 0
        ? input.pathApi.join(input.homeDir, ".config")
        : input.env.XDG_CONFIG_HOME;
    case "win32":
      return input.env.APPDATA === undefined || input.env.APPDATA.length === 0
        ? input.pathApi.join(input.homeDir, "AppData", "Roaming")
        : input.env.APPDATA;
  }
}

function resolvePlatform(value: DcsReferencePlatform | undefined): DcsReferencePlatform {
  if (value !== undefined) return value;
  return process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux";
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function diagnostic(code: string, message: string, path?: string): DcsDiagnostic {
  return { code, message, ...(path === undefined ? {} : { path }), severity: "error" };
}

function withSource(diagnostic: DcsDiagnostic, source: DcsConfigLayerSource): DcsDiagnostic {
  return { ...diagnostic, source };
}
