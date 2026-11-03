import { readFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  parseConfigDocument,
  resolveConfigLayers,
  type ConfigContractBundle,
  type DcsDiagnostic,
  type DcsResolutionLayer,
  type JsonObject,
} from "@reliverse/dcs-contract";

import { effectiveConfigRevision } from "./discovery";
import {
  discoverDcsOwnerConfig,
  type DcsDiscoveryCandidate,
  type DcsDiscoveryScopeRoot,
  type DcsOwnerDiscoveryPlan,
  type DefinedDcsOwner,
} from "./owner-discovery";

export interface DcsHostResolveInput {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly paths: {
    readonly globalConfigPath: string;
    readonly workspaceRoot: string;
  };
}

export interface DcsHostConfigProviderOptions {
  readonly bundle: ConfigContractBundle;
  readonly explicitEnvName?: string;
  readonly owner: DefinedDcsOwner;
  readonly resolveExplicitPath?: (input: DcsHostResolveInput) => string | undefined;
  readonly resolveScopes?: (input: DcsHostResolveInput) => readonly DcsDiscoveryScopeRoot[];
  readonly loadTrustedTypeScript?: (
    candidate: DcsDiscoveryCandidate,
  ) => Promise<JsonObject> | JsonObject;
}

export interface DcsHostConfigResolution {
  readonly diagnostics: readonly DcsDiagnostic[];
  readonly discovery: {
    readonly activePath?: string;
    readonly candidatePaths: readonly string[];
    readonly diagnosticCodes: readonly string[];
    readonly explicit: boolean;
    readonly owner: string;
  };
  readonly effectiveRevision?: string;
  readonly ok: boolean;
  readonly resolved?: ReturnType<typeof resolveConfigLayers>["resolved"];
}

function envName(owner: DefinedDcsOwner): string {
  return `${owner.owner.replaceAll("-", "_").toUpperCase()}_CONFIG`;
}

function defaultScopes(input: DcsHostResolveInput): readonly DcsDiscoveryScopeRoot[] {
  const scopes: DcsDiscoveryScopeRoot[] = [
    { root: dirname(input.paths.globalConfigPath), scope: "user" },
    { root: input.paths.workspaceRoot, scope: "repository" },
  ];
  if (input.cwd !== input.paths.workspaceRoot) scopes.push({ root: input.cwd, scope: "package" });
  return scopes;
}

function discoveryDiagnostics(plan: DcsOwnerDiscoveryPlan): DcsDiagnostic[] {
  return plan.diagnostics.map((entry) => ({
    code: entry.code,
    message:
      entry.paths.length > 1
        ? `${entry.message} Candidates: ${entry.paths.join(", ")}.`
        : entry.message,
    severity:
      plan.active?.provenance === "explicit" && entry.code === "DCS_CONFIG_AMBIGUOUS"
        ? "warning"
        : entry.severity,
    source: {
      kind: "dcs-discovery",
      ...(entry.paths[0] === undefined ? {} : { location: entry.paths[0] }),
    },
  }));
}

async function parseCandidate(
  candidate: DcsDiscoveryCandidate,
  options: DcsHostConfigProviderOptions,
): Promise<{ diagnostics: readonly DcsDiagnostic[]; layer?: DcsResolutionLayer }> {
  let value: JsonObject | string;
  if (candidate.format === "ts") {
    if (!options.loadTrustedTypeScript) {
      return {
        diagnostics: [
          {
            code: "DCS_TS_CONFIG_LOADER_REQUIRED",
            message: `No trusted TypeScript loader is registered for ${candidate.path}.`,
            severity: "error",
            source: { kind: "dcs-discovery", location: candidate.path },
          },
        ],
      };
    }
    value = await options.loadTrustedTypeScript(candidate);
  } else if (candidate.format === "yaml") {
    return {
      diagnostics: [
        {
          code: "DCS_YAML_CONFIG_LOADER_REQUIRED",
          message: `No YAML parser is registered for ${candidate.path}.`,
          severity: "error",
          source: { kind: "dcs-discovery", location: candidate.path },
        },
      ],
    };
  } else {
    value = await readFile(candidate.path, "utf8");
  }

  const scope =
    candidate.scope === "user" ? "user" : candidate.scope === "package" ? "local" : "workspace";
  const parsed = parseConfigDocument(value, {
    bundle: options.bundle,
    scope,
    ...(candidate.format === "jsonc" ? { syntax: "jsonc" as const } : {}),
  });
  const sourceKind =
    candidate.scope === "user"
      ? "user-document"
      : candidate.scope === "package"
        ? "local-document"
        : "workspace-document";
  return {
    diagnostics: parsed.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      source: diagnostic.source ?? { kind: sourceKind, location: candidate.path },
    })),
    ...(parsed.document === undefined
      ? {}
      : {
          layer: {
            document: parsed.document,
            scope,
            source: {
              kind: sourceKind,
              location: candidate.path,
            },
          },
        }),
  };
}

export function createDcsHostConfigProvider(options: DcsHostConfigProviderOptions) {
  return Object.freeze({
    async resolve(input: DcsHostResolveInput): Promise<DcsHostConfigResolution> {
      const explicitPath =
        options.resolveExplicitPath?.(input) ??
        input.env[options.explicitEnvName ?? envName(options.owner)];
      const plan = await discoverDcsOwnerConfig({
        ...(explicitPath === undefined ? {} : { explicitPath }),
        allowTrustedTypeScript: options.loadTrustedTypeScript !== undefined,
        owner: options.owner,
        scopes: options.resolveScopes?.(input) ?? defaultScopes(input),
      });
      const diagnostics = discoveryDiagnostics(plan);
      const selected =
        plan.active?.provenance === "explicit"
          ? [plan.active]
          : plan.mainCandidates
              .filter((candidate) => {
                const competing = plan.diagnostics.find(
                  (entry) =>
                    entry.code === "DCS_CONFIG_AMBIGUOUS" && entry.paths.includes(candidate.path),
                );
                return competing === undefined;
              })
              .sort((left, right) => {
                const rank = { user: 0, repository: 1, package: 2 } as const;
                return rank[left.scope] - rank[right.scope];
              });
      const layers: DcsResolutionLayer[] = [];
      for (const candidate of selected) {
        const parsed = await parseCandidate(candidate, options);
        diagnostics.push(...parsed.diagnostics);
        if (parsed.layer) layers.push(parsed.layer);
      }
      const resolved = resolveConfigLayers({ bundle: options.bundle, layers });
      diagnostics.push(...resolved.diagnostics);
      const ok = !diagnostics.some((entry) => entry.severity === "error") && resolved.ok;
      const effectiveRevision =
        resolved.resolved === undefined
          ? undefined
          : await effectiveConfigRevision(resolved.resolved);
      return {
        diagnostics: Object.freeze(diagnostics),
        discovery: Object.freeze({
          ...(plan.active === undefined ? {} : { activePath: plan.active.path }),
          candidatePaths: Object.freeze(plan.candidates.map((candidate) => candidate.path)),
          diagnosticCodes: Object.freeze(plan.diagnostics.map((entry) => entry.code)),
          explicit: plan.explicit,
          owner: options.owner.owner,
        }),
        ok,
        ...(effectiveRevision === undefined ? {} : { effectiveRevision }),
        ...(resolved.resolved === undefined ? {} : { resolved: resolved.resolved }),
      };
    },
  });
}
