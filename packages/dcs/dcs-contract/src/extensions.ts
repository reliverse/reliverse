import type { ConfigContractBundle, DcsDiagnostic } from "./contract";
import {
  cloneJsonValue,
  freezeJsonValue,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "./json";
import { isSchemaObject, type JsonSchema, validateJsonValueAgainstSchema } from "./schema";

/**
 * DCS extension contracts are local data artifacts. They never imply registry
 * lookup, network access, package execution, or executable configuration.
 */
export const DCS_EXTENSION_CONTRACT_VERSION = "0.0.1" as const;
export const DCS_EXTENSION_BUNDLE_VERSION = "0.0.1" as const;

export interface DcsExtensionPresentation {
  readonly description?: string;
  readonly group?: string;
  readonly icon?: string;
  readonly label?: string;
  readonly order?: number;
}

export interface DcsExtensionContract {
  readonly $dcs: {
    readonly compatibleDcsSpecVersions: readonly string[];
    readonly extensionVersion: number;
    readonly format: "dcs-extension-contract";
    readonly id: string;
    readonly version: typeof DCS_EXTENSION_CONTRACT_VERSION;
  };
  readonly presentation?: DcsExtensionPresentation;
  /** Schema for the value under `$extensions[extensionId]`. */
  readonly schema: JsonSchema;
}

/**
 * A product CCB may constrain which locally known extension descriptor version
 * is suitable. Requirements never fetch or install the descriptor themselves.
 */
export interface DcsExtensionRequirement {
  readonly id: string;
  readonly maxVersion?: number;
  readonly minVersion?: number;
  readonly required?: boolean;
}

export interface DcsExtensionBundle {
  readonly $dcs: {
    readonly format: "dcs-extension-bundle";
    readonly version: typeof DCS_EXTENSION_BUNDLE_VERSION;
  };
  readonly extensions: readonly DcsExtensionContract[];
}

export interface DcsExtensionRegistry {
  readonly contracts: Readonly<Record<string, DcsExtensionContract>>;
}

export interface DcsExtensionValidationOptions {
  readonly bundle: Pick<ConfigContractBundle, "$dcs" | "extensionRequirements">;
  readonly extensions: JsonObject;
  readonly registry?: DcsExtensionRegistry;
}

export interface ParseDcsExtensionBundleResult {
  readonly bundle?: DcsExtensionBundle;
  readonly diagnostics: readonly DcsDiagnostic[];
  readonly ok: boolean;
}

export class DcsExtensionValidationError extends Error {
  public readonly diagnostics: readonly DcsDiagnostic[];

  public constructor(diagnostics: readonly DcsDiagnostic[]) {
    super(
      diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join("\n") || "DCS extension validation failed.",
    );
    this.name = "DcsExtensionValidationError";
    this.diagnostics = diagnostics;
  }
}

export function createDcsExtensionContract(contract: DcsExtensionContract): DcsExtensionContract {
  const diagnostics = validateDcsExtensionContract(contract);
  if (hasErrors(diagnostics)) {
    throw new DcsExtensionValidationError(diagnostics);
  }

  return freezeContract(contract);
}

export function createDcsExtensionBundle(bundle: DcsExtensionBundle): DcsExtensionBundle {
  const diagnostics = validateDcsExtensionBundle(bundle);
  if (hasErrors(diagnostics)) {
    throw new DcsExtensionValidationError(diagnostics);
  }

  return Object.freeze({
    $dcs: Object.freeze({ ...bundle.$dcs }),
    extensions: Object.freeze(bundle.extensions.map((contract) => freezeContract(contract))),
  });
}

export function createDcsExtensionRegistry(
  contracts: readonly DcsExtensionContract[],
): DcsExtensionRegistry {
  const diagnostics: DcsDiagnostic[] = [];
  const entries: Record<string, DcsExtensionContract> = {};

  for (const contract of contracts) {
    diagnostics.push(...validateDcsExtensionContract(contract));
    const id = contract.$dcs.id;
    if (entries[id] !== undefined) {
      diagnostics.push(
        error("DCS6014", `Duplicate extension contract ID ${JSON.stringify(id)}.`, "/extensions"),
      );
      continue;
    }
    entries[id] = freezeContract(contract);
  }

  if (hasErrors(diagnostics)) {
    throw new DcsExtensionValidationError(diagnostics);
  }

  return Object.freeze({ contracts: Object.freeze(entries) });
}

export function parseDcsExtensionBundle(input: JsonObject | string): ParseDcsExtensionBundleResult {
  let value: JsonValue;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as JsonValue;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unknown JSON parser error.";
      return Object.freeze({
        diagnostics: Object.freeze([
          error("DCS6001", `Unable to parse extension bundle JSON: ${message}`, ""),
        ]),
        ok: false,
      });
    }
  } else {
    value = input;
  }

  if (!isJsonObject(value)) {
    return Object.freeze({
      diagnostics: Object.freeze([
        error("DCS6002", "Extension bundle root must be an object.", ""),
      ]),
      ok: false,
    });
  }

  const candidate = value as unknown as DcsExtensionBundle;
  const diagnostics = validateDcsExtensionBundle(candidate);
  if (hasErrors(diagnostics)) {
    return Object.freeze({ diagnostics: Object.freeze(diagnostics), ok: false });
  }

  return Object.freeze({
    bundle: createDcsExtensionBundle(candidate),
    diagnostics: Object.freeze(diagnostics),
    ok: true,
  });
}

export function validateDcsExtensionContract(
  contract: DcsExtensionContract,
): readonly DcsDiagnostic[] {
  const diagnostics: DcsDiagnostic[] = [];
  const metadata = contract?.$dcs;

  if (!isJsonObject(metadata)) {
    return Object.freeze([
      error("DCS6003", "Extension contract must declare a $dcs object.", "/$dcs"),
    ]);
  }

  if (metadata.format !== "dcs-extension-contract") {
    diagnostics.push(
      error(
        "DCS6004",
        "Extension contract $dcs.format must be dcs-extension-contract.",
        "/$dcs/format",
      ),
    );
  }
  if (metadata.version !== DCS_EXTENSION_CONTRACT_VERSION) {
    diagnostics.push(
      error(
        "DCS6005",
        `Unsupported extension contract version ${JSON.stringify(metadata.version)}.`,
        "/$dcs/version",
      ),
    );
  }
  if (typeof metadata.id !== "string" || !isExtensionId(metadata.id)) {
    diagnostics.push(
      error(
        "DCS6006",
        "Extension contract ID must be a lower-case reverse-domain identifier.",
        "/$dcs/id",
      ),
    );
  }
  if (!isNonNegativeInteger(metadata.extensionVersion)) {
    diagnostics.push(
      error(
        "DCS6007",
        "extensionVersion must be a non-negative integer.",
        "/$dcs/extensionVersion",
      ),
    );
  }
  if (
    !Array.isArray(metadata.compatibleDcsSpecVersions) ||
    metadata.compatibleDcsSpecVersions.length === 0
  ) {
    diagnostics.push(
      error(
        "DCS6008",
        "compatibleDcsSpecVersions must declare at least one DCS spec version.",
        "/$dcs/compatibleDcsSpecVersions",
      ),
    );
  } else {
    const seen = new Set<string>();
    for (const [index, version] of metadata.compatibleDcsSpecVersions.entries()) {
      if (typeof version !== "string" || version.trim().length === 0) {
        diagnostics.push(
          error(
            "DCS6009",
            "compatibleDcsSpecVersions entries must be non-empty strings.",
            `/$dcs/compatibleDcsSpecVersions/${index}`,
          ),
        );
      } else if (seen.has(version)) {
        diagnostics.push(
          error(
            "DCS6010",
            `compatibleDcsSpecVersions repeats ${JSON.stringify(version)}.`,
            `/$dcs/compatibleDcsSpecVersions/${index}`,
          ),
        );
      }
      seen.add(version);
    }
  }

  if (!isJsonObject(contract.schema) || !isSchemaObject(contract.schema)) {
    diagnostics.push(error("DCS6011", "Extension schema root must describe an object.", "/schema"));
  } else if (typeof contract.schema.$schema !== "string") {
    diagnostics.push(
      error(
        "DCS6012",
        "Extension schema must declare its JSON Schema dialect in $schema.",
        "/schema/$schema",
      ),
    );
  }

  validatePresentation(contract.presentation, diagnostics);
  return Object.freeze(diagnostics);
}

export function validateDcsExtensionBundle(bundle: DcsExtensionBundle): readonly DcsDiagnostic[] {
  const diagnostics: DcsDiagnostic[] = [];
  const metadata = bundle?.$dcs;

  if (!isJsonObject(metadata)) {
    return Object.freeze([
      error("DCS6002", "Extension bundle must declare a $dcs object.", "/$dcs"),
    ]);
  }
  if (metadata.format !== "dcs-extension-bundle") {
    diagnostics.push(
      error(
        "DCS6013",
        "Extension bundle $dcs.format must be dcs-extension-bundle.",
        "/$dcs/format",
      ),
    );
  }
  if (metadata.version !== DCS_EXTENSION_BUNDLE_VERSION) {
    diagnostics.push(
      error(
        "DCS6015",
        `Unsupported extension bundle version ${JSON.stringify(metadata.version)}.`,
        "/$dcs/version",
      ),
    );
  }
  if (!Array.isArray(bundle.extensions)) {
    diagnostics.push(
      error("DCS6016", "Extension bundle extensions must be an array.", "/extensions"),
    );
    return Object.freeze(diagnostics);
  }

  const seen = new Set<string>();
  for (const [index, contract] of bundle.extensions.entries()) {
    diagnostics.push(...validateDcsExtensionContract(contract));
    const id = contract?.$dcs?.id;
    if (typeof id === "string") {
      if (seen.has(id)) {
        diagnostics.push(
          error(
            "DCS6014",
            `Extension bundle repeats contract ${JSON.stringify(id)}.`,
            `/extensions/${index}`,
          ),
        );
      }
      seen.add(id);
    }
  }

  return Object.freeze(diagnostics);
}

/** Validates product-declared requirements while keeping unknown extensions opaque. */
export function validateDcsExtensionRequirements(
  requirements: readonly DcsExtensionRequirement[] | undefined,
): readonly DcsDiagnostic[] {
  if (requirements === undefined) {
    return Object.freeze([]);
  }

  const diagnostics: DcsDiagnostic[] = [];
  const seen = new Set<string>();
  for (const [index, requirement] of requirements.entries()) {
    const path = `/extensionRequirements/${index}`;
    if (!isJsonObject(requirement)) {
      diagnostics.push(error("DCS6017", "Extension requirement must be an object.", path));
      continue;
    }
    if (!isExtensionId(requirement.id)) {
      diagnostics.push(
        error(
          "DCS6018",
          "Extension requirement ID must be a lower-case reverse-domain identifier.",
          `${path}/id`,
        ),
      );
    }
    if (seen.has(requirement.id)) {
      diagnostics.push(
        error(
          "DCS6019",
          `Extension requirement ${JSON.stringify(requirement.id)} is declared more than once.`,
          `${path}/id`,
        ),
      );
    }
    seen.add(requirement.id);
    if (requirement.minVersion !== undefined && !isNonNegativeInteger(requirement.minVersion)) {
      diagnostics.push(
        error(
          "DCS6020",
          "Extension requirement minVersion must be a non-negative integer.",
          `${path}/minVersion`,
        ),
      );
    }
    if (requirement.maxVersion !== undefined && !isNonNegativeInteger(requirement.maxVersion)) {
      diagnostics.push(
        error(
          "DCS6021",
          "Extension requirement maxVersion must be a non-negative integer.",
          `${path}/maxVersion`,
        ),
      );
    }
    if (
      requirement.minVersion !== undefined &&
      requirement.maxVersion !== undefined &&
      requirement.minVersion > requirement.maxVersion
    ) {
      diagnostics.push(
        error("DCS6022", "Extension requirement minVersion must not exceed maxVersion.", path),
      );
    }
    if (requirement.required !== undefined && typeof requirement.required !== "boolean") {
      diagnostics.push(
        error(
          "DCS6023",
          "Extension requirement required must be a boolean when present.",
          `${path}/required`,
        ),
      );
    }
  }
  return Object.freeze(diagnostics);
}

/**
 * Validates known extension namespaces. Unknown namespaces remain preserved and
 * produce a warning, never a destructive error. A required namespace is still
 * an error when absent even if no local registry is available.
 */
export function validateDcsExtensionDocument(
  options: DcsExtensionValidationOptions,
): readonly DcsDiagnostic[] {
  const diagnostics: DcsDiagnostic[] = [];
  const requirements = options.bundle.extensionRequirements ?? [];
  const requirementById = new Map(requirements.map((entry) => [entry.id, entry] as const));

  for (const requirement of requirements) {
    const extensionValue = options.extensions[requirement.id];
    if (requirement.required === true && extensionValue === undefined) {
      diagnostics.push(
        error(
          "DCS6024",
          `Required extension ${JSON.stringify(requirement.id)} is missing.`,
          "/$extensions",
        ),
      );
    }
  }

  for (const [id, value] of Object.entries(options.extensions)) {
    const path = `/$extensions/${escapeSegment(id)}`;
    if (!isExtensionId(id)) {
      diagnostics.push(
        error(
          "DCS6025",
          `Extension ID ${JSON.stringify(id)} must be a lower-case reverse-domain identifier.`,
          path,
        ),
      );
      continue;
    }
    if (!isJsonObject(value)) {
      diagnostics.push(
        error("DCS6026", `Extension ${JSON.stringify(id)} must contain an object value.`, path),
      );
      continue;
    }

    const contract = options.registry?.contracts[id];
    if (contract === undefined) {
      diagnostics.push(
        warning(
          "DCS6027",
          `Extension ${JSON.stringify(id)} is unknown to this host and remains opaque.`,
          path,
        ),
      );
      continue;
    }

    const requirement = requirementById.get(id);
    if (!contract.$dcs.compatibleDcsSpecVersions.includes(options.bundle.$dcs.specVersion)) {
      diagnostics.push(
        error(
          "DCS6028",
          `Extension ${JSON.stringify(id)} does not support DCS spec ${options.bundle.$dcs.specVersion}.`,
          path,
        ),
      );
    }
    if (
      requirement !== undefined &&
      !isVersionCompatible(contract.$dcs.extensionVersion, requirement)
    ) {
      diagnostics.push(
        error(
          "DCS6029",
          `Extension ${JSON.stringify(id)} version ${contract.$dcs.extensionVersion} does not satisfy the product requirement.`,
          path,
        ),
      );
    }

    for (const issue of validateJsonValueAgainstSchema(value, contract.schema, path)) {
      diagnostics.push(
        error(
          "DCS6030",
          `Extension ${JSON.stringify(id)} is invalid: ${issue.message}`,
          issue.path,
        ),
      );
    }
  }

  if (options.registry !== undefined) {
    for (const requirement of requirements) {
      if (options.registry.contracts[requirement.id] === undefined) {
        diagnostics.push(
          warning(
            "DCS6031",
            `No local extension contract is available for declared extension ${JSON.stringify(requirement.id)}.`,
            "/extensionRequirements",
          ),
        );
      }
    }
  }

  return Object.freeze(diagnostics);
}

function freezeContract(contract: DcsExtensionContract): DcsExtensionContract {
  return Object.freeze({
    $dcs: Object.freeze({
      ...contract.$dcs,
      compatibleDcsSpecVersions: Object.freeze([...contract.$dcs.compatibleDcsSpecVersions]),
    }),
    ...(contract.presentation === undefined
      ? {}
      : { presentation: Object.freeze({ ...contract.presentation }) }),
    schema: freezeJsonValue(cloneJsonValue(contract.schema)) as JsonSchema,
  });
}

function validatePresentation(value: unknown, diagnostics: DcsDiagnostic[]): void {
  if (value === undefined) {
    return;
  }
  if (!isJsonObject(value)) {
    diagnostics.push(
      error("DCS6032", "Extension presentation must be an object when present.", "/presentation"),
    );
    return;
  }
  const presentation = value as DcsExtensionPresentation;
  for (const key of ["description", "group", "icon", "label"] as const) {
    const entry = presentation[key];
    if (entry !== undefined && (typeof entry !== "string" || entry.trim().length === 0)) {
      diagnostics.push(
        error(
          "DCS6033",
          `Extension presentation.${key} must be a non-empty string when present.`,
          `/presentation/${key}`,
        ),
      );
    }
  }
  if (
    presentation.order !== undefined &&
    (!Number.isInteger(presentation.order) || !Number.isFinite(presentation.order))
  ) {
    diagnostics.push(
      error(
        "DCS6034",
        "Extension presentation.order must be a finite integer when present.",
        "/presentation/order",
      ),
    );
  }
}

function isVersionCompatible(version: number, requirement: DcsExtensionRequirement): boolean {
  return (
    (requirement.minVersion === undefined || version >= requirement.minVersion) &&
    (requirement.maxVersion === undefined || version <= requirement.maxVersion)
  );
}

function isExtensionId(value: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function escapeSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function hasErrors(diagnostics: readonly DcsDiagnostic[]): boolean {
  return diagnostics.some((entry) => entry.severity === "error");
}

function error(code: string, message: string, path?: string): DcsDiagnostic {
  return { code, message, ...(path === undefined ? {} : { path }), severity: "error" };
}

function warning(code: string, message: string, path?: string): DcsDiagnostic {
  return { code, message, ...(path === undefined ? {} : { path }), severity: "warning" };
}
