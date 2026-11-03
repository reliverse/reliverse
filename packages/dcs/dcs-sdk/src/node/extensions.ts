import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

import {
  DcsExtensionValidationError,
  createDcsExtensionRegistry,
  parseDcsExtensionBundle,
  type DcsDiagnostic,
  type DcsExtensionContract,
  type DcsExtensionRegistry,
} from "@reliverse/dcs-contract";

export interface DcsExtensionBundleSource {
  readonly kind: "explicit" | "package" | "workspace";
  readonly location: string;
  readonly packageName?: string;
}

export interface LoadDcsExtensionRegistryOptions {
  /** Explicit local bundle files, resolved relative to the current host. */
  readonly bundlePaths?: readonly string[];
  /** Workspace root contributes `.dcs/extensions/*.dcs-extension-bundle.json`. */
  readonly workspaceRoot?: string;
  /** Explicit package roots whose package.json may declare `dcs.extensionBundles`. */
  readonly packageRoots?: readonly string[];
}

export interface DcsExtensionRegistryLoadResult {
  readonly diagnostics: readonly DcsDiagnostic[];
  readonly ok: boolean;
  readonly registry?: DcsExtensionRegistry;
  readonly sources: readonly DcsExtensionBundleSource[];
}

/**
 * Loads only local data artifacts. DCS intentionally does not resolve URLs,
 * registry IDs, package names, or arbitrary executable package exports here.
 */
export async function loadDcsExtensionRegistry(
  options: LoadDcsExtensionRegistryOptions = {},
): Promise<DcsExtensionRegistryLoadResult> {
  const diagnostics: DcsDiagnostic[] = [];
  const sources: DcsExtensionBundleSource[] = [];
  const contracts: DcsExtensionContract[] = [];
  const locations = new Map<string, DcsExtensionBundleSource>();

  for (const location of options.bundlePaths ?? []) {
    addSource(locations, {
      kind: "explicit",
      location: path.resolve(location),
    });
  }

  if (options.workspaceRoot !== undefined) {
    const directory = path.join(path.resolve(options.workspaceRoot), ".dcs", "extensions");
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".dcs-extension-bundle.json")) {
          continue;
        }
        addSource(locations, {
          kind: "workspace",
          location: path.join(directory, entry.name),
        });
      }
    } catch (caught) {
      if (!isMissingFileError(caught)) {
        diagnostics.push(
          error(
            "DCS6101",
            `Unable to read DCS workspace extension directory: ${message(caught)}`,
            directory,
          ),
        );
      }
    }
  }

  for (const rootInput of options.packageRoots ?? []) {
    const root = path.resolve(rootInput);
    const manifestLocation = path.join(root, "package.json");
    try {
      const manifestValue: unknown = JSON.parse(await readFile(manifestLocation, "utf8"));
      const packageName =
        isRecord(manifestValue) && typeof manifestValue.name === "string"
          ? manifestValue.name
          : undefined;
      const bundlePaths = readPackageExtensionBundles(manifestValue);
      for (const bundlePath of bundlePaths) {
        addSource(locations, {
          kind: "package",
          location: path.resolve(root, bundlePath),
          ...(packageName === undefined ? {} : { packageName }),
        });
      }
    } catch (caught) {
      diagnostics.push(
        error(
          "DCS6102",
          `Unable to read DCS package extension manifest: ${message(caught)}`,
          manifestLocation,
        ),
      );
    }
  }

  for (const source of locations.values()) {
    sources.push(source);
    try {
      const parsed = parseDcsExtensionBundle(await readFile(source.location, "utf8"));
      diagnostics.push(...parsed.diagnostics.map((entry) => withSource(entry, source)));
      if (parsed.bundle !== undefined) {
        contracts.push(...parsed.bundle.extensions);
      }
    } catch (caught) {
      diagnostics.push(
        error(
          "DCS6103",
          `Unable to read DCS extension bundle: ${message(caught)}`,
          source.location,
        ),
      );
    }
  }

  let registry: DcsExtensionRegistry | undefined;
  try {
    registry = createDcsExtensionRegistry(contracts);
  } catch (caught) {
    if (caught instanceof DcsExtensionValidationError) {
      diagnostics.push(...caught.diagnostics);
    } else {
      throw caught;
    }
  }

  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    ok: !diagnostics.some((entry) => entry.severity === "error"),
    ...(registry === undefined ? {} : { registry }),
    sources: Object.freeze(sources),
  });
}

/** Stable JSON shape for package.json `dcs.extensionBundles`. */
export function readPackageExtensionBundles(value: unknown): readonly string[] {
  if (!isRecord(value) || !isRecord(value.dcs) || !Array.isArray(value.dcs.extensionBundles)) {
    return [];
  }
  return Object.freeze(
    value.dcs.extensionBundles.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    ),
  );
}

function addSource(
  sources: Map<string, DcsExtensionBundleSource>,
  source: DcsExtensionBundleSource,
): void {
  if (!sources.has(source.location)) {
    sources.set(source.location, source);
  }
}

function withSource(diagnostic: DcsDiagnostic, source: DcsExtensionBundleSource): DcsDiagnostic {
  return {
    ...diagnostic,
    source: {
      kind: `extension-${source.kind}-bundle`,
      location: source.location,
    },
  };
}

function error(code: string, messageText: string, location: string): DcsDiagnostic {
  return {
    code,
    message: messageText,
    severity: "error",
    source: { kind: "extension-registry", location },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown filesystem error.";
}
