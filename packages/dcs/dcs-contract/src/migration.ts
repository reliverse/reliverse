import type { ConfigContractBundle, DcsDiagnostic } from "./contract";
import {
  cloneJsonValue,
  deleteJsonObjectPointer,
  getJsonPointer,
  isJsonArray,
  isJsonObject,
  isValidJsonPointer,
  setJsonObjectPointer,
  type JsonObject,
  type JsonValue,
} from "./json";

/**
 * Declarative migration artifacts intentionally contain data only. DCS 0.0.9
 * does not execute callbacks, imports, or product code while migrating config.
 */
export const DCS_MIGRATION_PLAN_VERSION = "0.0.1" as const;
export const DCS_MIGRATION_RECEIPT_VERSION = "0.0.1" as const;

export interface DcsMigrationVersion {
  readonly contractVersion: number;
  readonly documentVersion: number;
}

export interface DcsMigrationPlan {
  readonly $dcs: {
    readonly format: "dcs-migration-plan";
    readonly from: DcsMigrationVersion;
    readonly id: string;
    readonly to: DcsMigrationVersion;
    readonly version: typeof DCS_MIGRATION_PLAN_VERSION;
  };
  readonly operations: readonly DcsMigrationOperation[];
}

export type DcsMigrationOperation =
  | {
      /** Rename is semantic sugar for a move, retained for readable migration plans. */
      readonly from: string;
      readonly op: "rename";
      readonly to: string;
    }
  | {
      readonly from: string;
      readonly op: "move";
      readonly to: string;
    }
  | {
      readonly op: "delete";
      readonly path: string;
    }
  | {
      /**
       * Reads child paths from one object and writes them to independently named
       * target fields. `from` values are JSON Pointer paths relative to source.
       */
      readonly from: string;
      readonly op: "split";
      readonly removeSource?: boolean;
      readonly targets: readonly {
        readonly from: string;
        readonly to: string;
      }[];
    }
  | {
      /** Combines named source fields into one object target. */
      readonly members: readonly {
        readonly from: string;
        readonly key: string;
      }[];
      readonly op: "merge";
      readonly removeSources?: boolean;
      readonly to: string;
    };

export type DcsMigrationDefaultsMode = "adopt-new-defaults" | "preserve-effective";

export interface DcsMigrationChange {
  readonly from?: string;
  readonly kind: "deleted" | "merged" | "moved" | "renamed" | "split";
  readonly to?: string;
}

export interface ApplyDcsMigrationPlanOptions {
  readonly document: JsonObject;
  readonly plan: DcsMigrationPlan;
}

export interface ApplyDcsMigrationPlanResult {
  readonly changes: readonly DcsMigrationChange[];
  readonly document: JsonObject;
  /** Maps source paths to their destination paths for defaults preservation. */
  readonly pathMap: Readonly<Record<string, string>>;
}

export class DcsMigrationValidationError extends Error {
  public readonly diagnostics: readonly DcsDiagnostic[];

  public constructor(diagnostics: readonly DcsDiagnostic[]) {
    super(
      diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join("\n") ||
        "DCS migration plan validation failed.",
    );
    this.name = "DcsMigrationValidationError";
    this.diagnostics = diagnostics;
  }
}

/** Finds a target-bundle plan for the exact source contract/document pair. */
export function findDcsMigrationPlan(
  targetBundle: ConfigContractBundle,
  source: DcsMigrationVersion,
): DcsMigrationPlan | undefined {
  return targetBundle.migrations?.find(
    (plan) =>
      plan.$dcs.id === targetBundle.$dcs.id &&
      plan.$dcs.from.contractVersion === source.contractVersion &&
      plan.$dcs.from.documentVersion === source.documentVersion &&
      plan.$dcs.to.contractVersion === targetBundle.$dcs.contractVersion &&
      plan.$dcs.to.documentVersion === targetBundle.$dcs.documentVersion,
  );
}

/** Validates one plan against a target contract without executing it. */
export function validateDcsMigrationPlan(
  plan: DcsMigrationPlan,
  target: Pick<ConfigContractBundle, "$dcs" | "fields">,
): readonly DcsDiagnostic[] {
  const diagnostics: DcsDiagnostic[] = [];
  const meta = plan.$dcs;

  if (meta.format !== "dcs-migration-plan") {
    diagnostics.push(
      error(
        "DCS5001",
        "Migration plan format must be dcs-migration-plan.",
        "/migrations/$dcs/format",
      ),
    );
  }
  if (meta.version !== DCS_MIGRATION_PLAN_VERSION) {
    diagnostics.push(
      error(
        "DCS5002",
        `Unsupported migration plan version ${JSON.stringify(meta.version)}.`,
        "/migrations/$dcs/version",
      ),
    );
  }
  if (meta.id !== target.$dcs.id) {
    diagnostics.push(
      error("DCS5003", "Migration plan id must match target contract id.", "/migrations/$dcs/id"),
    );
  }
  if (!isVersion(meta.from)) {
    diagnostics.push(
      error(
        "DCS5004",
        "Migration plan from version must contain positive contractVersion and documentVersion.",
        "/migrations/$dcs/from",
      ),
    );
  }
  if (!isVersion(meta.to)) {
    diagnostics.push(
      error(
        "DCS5005",
        "Migration plan to version must contain positive contractVersion and documentVersion.",
        "/migrations/$dcs/to",
      ),
    );
  }
  if (
    meta.to.contractVersion !== target.$dcs.contractVersion ||
    meta.to.documentVersion !== target.$dcs.documentVersion
  ) {
    diagnostics.push(
      error(
        "DCS5006",
        "Migration plan target version must match the enclosing CCB.",
        "/migrations/$dcs/to",
      ),
    );
  }
  if (
    meta.from.contractVersion === meta.to.contractVersion &&
    meta.from.documentVersion === meta.to.documentVersion
  ) {
    diagnostics.push(
      error(
        "DCS5007",
        "Migration plan source and target versions must differ.",
        "/migrations/$dcs",
      ),
    );
  }
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) {
    diagnostics.push(
      error(
        "DCS5008",
        "Migration plan must declare at least one operation.",
        "/migrations/operations",
      ),
    );
  }

  const seenSourcePlans = new Set<string>();
  for (const operation of plan.operations ?? []) {
    validateOperation(operation, target, diagnostics, seenSourcePlans);
  }

  return Object.freeze(diagnostics);
}

/** Validates every embedded plan and detects duplicate source-version routes. */
export function validateDcsMigrationPlans(
  plans: readonly DcsMigrationPlan[] | undefined,
  target: Pick<ConfigContractBundle, "$dcs" | "fields">,
): readonly DcsDiagnostic[] {
  if (plans === undefined) {
    return Object.freeze([]);
  }
  const diagnostics: DcsDiagnostic[] = [];
  const seen = new Set<string>();
  for (const plan of plans) {
    diagnostics.push(...validateDcsMigrationPlan(plan, target));
    const key = `${plan.$dcs.id}\u0000${plan.$dcs.from.contractVersion}\u0000${plan.$dcs.from.documentVersion}`;
    if (seen.has(key)) {
      diagnostics.push(
        error(
          "DCS5009",
          "A CCB may declare only one migration plan per source version.",
          "/migrations",
        ),
      );
    }
    seen.add(key);
  }
  return Object.freeze(diagnostics);
}

/**
 * Transforms one sparse configuration document according to a fully validated
 * declarative plan. Extensions are opaque and copied unchanged. The document
 * envelope is advanced to the plan target version.
 */
export function applyDcsMigrationPlan(
  options: ApplyDcsMigrationPlanOptions,
): ApplyDcsMigrationPlanResult {
  const diagnostics = validateDcsMigrationPlan(options.plan, {
    $dcs: {
      contractVersion: options.plan.$dcs.to.contractVersion,
      documentVersion: options.plan.$dcs.to.documentVersion,
      fileStem: "migration-target",
      id: options.plan.$dcs.id,
      specVersion: "0.0.1",
    },
    fields: Object.create(null) as Record<string, never>,
  });
  // The synthetic validation above intentionally checks plan structure. Target
  // field existence is validated by the host's final target-document validation.
  if (
    diagnostics.some(
      (diagnostic) => diagnostic.severity === "error" && diagnostic.code !== "DCS5014",
    )
  ) {
    throw new DcsMigrationValidationError(diagnostics);
  }

  let document = cloneJsonValue(options.document) as JsonObject;
  const changes: DcsMigrationChange[] = [];
  const pathMap: Record<string, string> = {};

  for (const operation of options.plan.operations) {
    switch (operation.op) {
      case "rename":
      case "move": {
        const value = getJsonPointer(document, operation.from);
        if (value !== undefined) {
          if (getJsonPointer(document, operation.to) !== undefined) {
            throw new TypeError(
              `DCS migration ${operation.op} destination already exists: ${operation.to}.`,
            );
          }
          document = setJsonObjectPointer(document, operation.to, cloneJsonValue(value));
          document = deleteJsonObjectPointer(document, operation.from);
        }
        document = rewriteResets(document, operation.from, [operation.to]);
        pathMap[operation.from] = operation.to;
        changes.push(
          Object.freeze({
            from: operation.from,
            kind: operation.op === "rename" ? "renamed" : "moved",
            to: operation.to,
          }),
        );
        break;
      }
      case "delete": {
        document = deleteJsonObjectPointer(document, operation.path);
        document = rewriteResets(document, operation.path, []);
        changes.push(Object.freeze({ from: operation.path, kind: "deleted" }));
        break;
      }
      case "split": {
        const source = getJsonPointer(document, operation.from);
        if (source !== undefined && !isJsonObject(source)) {
          throw new TypeError(`DCS split source ${operation.from} must be an object when present.`);
        }
        for (const target of operation.targets) {
          const absoluteFrom = joinPointers(operation.from, target.from);
          const value = getJsonPointer(document, absoluteFrom);
          if (value !== undefined) {
            if (getJsonPointer(document, target.to) !== undefined) {
              throw new TypeError(`DCS split destination already exists: ${target.to}.`);
            }
            document = setJsonObjectPointer(document, target.to, cloneJsonValue(value));
          }
          document = rewriteResets(document, absoluteFrom, [target.to]);
          pathMap[absoluteFrom] = target.to;
          changes.push(Object.freeze({ from: absoluteFrom, kind: "split", to: target.to }));
        }
        if (operation.removeSource !== false) {
          document = deleteJsonObjectPointer(document, operation.from);
          document = rewriteResets(
            document,
            operation.from,
            operation.targets.map((target) => target.to),
          );
        }
        break;
      }
      case "merge": {
        if (getJsonPointer(document, operation.to) !== undefined) {
          throw new TypeError(`DCS merge destination already exists: ${operation.to}.`);
        }
        const merged: Record<string, JsonValue> = {};
        for (const member of operation.members) {
          const value = getJsonPointer(document, member.from);
          if (value !== undefined) {
            Object.defineProperty(merged, member.key, {
              value: cloneJsonValue(value),
              enumerable: true,
              configurable: true,
              writable: true,
            });
          }
          const targetPath = joinPointers(operation.to, `/${escapeSegment(member.key)}`);
          pathMap[member.from] = targetPath;
          document = rewriteResets(document, member.from, [targetPath]);
          changes.push(Object.freeze({ from: member.from, kind: "merged", to: targetPath }));
        }
        if (Object.keys(merged).length > 0) {
          document = setJsonObjectPointer(document, operation.to, merged);
        }
        if (operation.removeSources !== false) {
          for (const member of operation.members) {
            document = deleteJsonObjectPointer(document, member.from);
          }
        }
        break;
      }
    }
  }

  document = writeEnvelope(document, options.plan.$dcs);
  return Object.freeze({
    changes: Object.freeze(changes),
    document,
    pathMap: Object.freeze(pathMap),
  });
}

/** Returns identity mappings for target fields that survived unchanged. */
export function createDcsMigrationPathMap(
  source: ConfigContractBundle,
  target: ConfigContractBundle,
  planResult: ApplyDcsMigrationPlanResult,
): Readonly<Record<string, string>> {
  const map: Record<string, string> = { ...planResult.pathMap };
  for (const path of Object.keys(source.fields)) {
    if (target.fields[path] !== undefined && map[path] === undefined) {
      map[path] = path;
    }
  }
  return Object.freeze(map);
}

function validateOperation(
  operation: DcsMigrationOperation,
  target: Pick<ConfigContractBundle, "$dcs" | "fields">,
  diagnostics: DcsDiagnostic[],
  seenSourcePlans: Set<string>,
): void {
  const checkProductPath = (path: string, location: string): void => {
    if (!isProductPointer(path)) {
      diagnostics.push(
        error(
          "DCS5010",
          `Migration path ${JSON.stringify(path)} must be a non-root product JSON Pointer.`,
          location,
        ),
      );
    }
  };
  const checkTargetPath = (path: string, location: string): void => {
    checkProductPath(path, location);
    if (target.fields[path] === undefined) {
      // Nested paths may be populated by split/merge and are validated by the
      // target document schema, so only emit a warning here.
      diagnostics.push(
        warning(
          "DCS5014",
          `Migration destination ${path} is not a declared leaf field; final document validation will decide compatibility.`,
          location,
        ),
      );
    }
  };

  switch (operation.op) {
    case "rename":
    case "move":
      checkProductPath(operation.from, "/migrations/operations/from");
      checkTargetPath(operation.to, "/migrations/operations/to");
      markSource(operation.from, seenSourcePlans, diagnostics);
      break;
    case "delete":
      checkProductPath(operation.path, "/migrations/operations/path");
      markSource(operation.path, seenSourcePlans, diagnostics);
      break;
    case "split":
      checkProductPath(operation.from, "/migrations/operations/from");
      if (!Array.isArray(operation.targets) || operation.targets.length === 0) {
        diagnostics.push(
          error(
            "DCS5011",
            "Split migration requires at least one target.",
            "/migrations/operations/targets",
          ),
        );
      }
      for (const targetEntry of operation.targets ?? []) {
        if (!isRelativePointer(targetEntry.from)) {
          diagnostics.push(
            error(
              "DCS5012",
              "Split source member must be a relative JSON Pointer such as /host.",
              "/migrations/operations/targets/from",
            ),
          );
        }
        checkTargetPath(targetEntry.to, "/migrations/operations/targets/to");
      }
      markSource(operation.from, seenSourcePlans, diagnostics);
      break;
    case "merge":
      checkTargetPath(operation.to, "/migrations/operations/to");
      if (!Array.isArray(operation.members) || operation.members.length === 0) {
        diagnostics.push(
          error(
            "DCS5013",
            "Merge migration requires at least one member.",
            "/migrations/operations/members",
          ),
        );
      }
      for (const member of operation.members ?? []) {
        checkProductPath(member.from, "/migrations/operations/members/from");
        if (
          typeof member.key !== "string" ||
          member.key.length === 0 ||
          member.key.startsWith("$")
        ) {
          diagnostics.push(
            error(
              "DCS5015",
              "Merge member key must be a non-reserved non-empty string.",
              "/migrations/operations/members/key",
            ),
          );
        }
        markSource(member.from, seenSourcePlans, diagnostics);
      }
      break;
  }
}

function markSource(path: string, seen: Set<string>, diagnostics: DcsDiagnostic[]): void {
  if (seen.has(path)) {
    diagnostics.push(
      error(
        "DCS5016",
        `Migration source path ${path} is consumed more than once.`,
        "/migrations/operations",
      ),
    );
  }
  seen.add(path);
}

function writeEnvelope(document: JsonObject, metadata: DcsMigrationPlan["$dcs"]): JsonObject {
  const next = cloneJsonValue(document) as Record<string, JsonValue>;
  const current = isJsonObject(next.$dcs) ? next.$dcs : {};
  next.$dcs = {
    ...current,
    contractVersion: metadata.to.contractVersion,
    documentVersion: metadata.to.documentVersion,
    id: metadata.id,
  };
  return next;
}

function rewriteResets(document: JsonObject, from: string, to: readonly string[]): JsonObject {
  const next = cloneJsonValue(document) as Record<string, JsonValue>;
  const envelope = isJsonObject(next.$dcs) ? { ...next.$dcs } : {};
  const resets = isJsonArray(envelope.resets)
    ? envelope.resets.filter((entry): entry is string => typeof entry === "string")
    : [];
  const rewritten = resets.flatMap((pointer) => {
    if (pointer === from) {
      return [...to];
    }
    if (pointer.startsWith(`${from}/`)) {
      return to.map((target) => `${target}${pointer.slice(from.length)}`);
    }
    return [pointer];
  });
  if (rewritten.length === 0) {
    delete envelope.resets;
  } else {
    envelope.resets = [...new Set(rewritten)].sort();
  }
  next.$dcs = envelope;
  return next;
}

function joinPointers(base: string, relative: string): string {
  return `${base}${relative}`;
}

function escapeSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isVersion(value: DcsMigrationVersion): boolean {
  return (
    Number.isInteger(value.contractVersion) &&
    value.contractVersion > 0 &&
    Number.isInteger(value.documentVersion) &&
    value.documentVersion > 0
  );
}

function isProductPointer(value: string): boolean {
  return value !== "" && isValidJsonPointer(value) && !value.startsWith("/$");
}

function isRelativePointer(value: string): boolean {
  return value !== "" && isValidJsonPointer(value) && !value.startsWith("/$");
}

function error(code: string, message: string, path?: string): DcsDiagnostic {
  return { code, message, ...(path === undefined ? {} : { path }), severity: "error" };
}

function warning(code: string, message: string, path?: string): DcsDiagnostic {
  return { code, message, ...(path === undefined ? {} : { path }), severity: "warning" };
}
