import { canonicalizeJson } from "./canonical";
import type { DcsDiagnostic, DcsScope } from "./contract";
import {
  cloneJsonValue,
  isJsonArray,
  isJsonObject,
  isJsonValue,
  type JsonObject,
  type JsonValue,
} from "./json";
import type { DcsDocumentSyntax } from "./jsonc";
import { isDcsProfileName, type DcsProfileName } from "./profiles";

export const DCS_LOCKFILE_FORMAT = "org.reliverse.dcs.lock";
export const DCS_LOCKFILE_VERSION = 1;

export type DcsLockInputScope = Exclude<DcsScope, "invocation">;

export interface DcsLockfileMetadata {
  readonly contractVersion: number;
  readonly documentVersion: number;
  readonly fileStem: string;
  readonly format: typeof DCS_LOCKFILE_FORMAT;
  readonly generatedBy: string;
  readonly id: string;
  readonly profile?: DcsProfileName;
  readonly version: typeof DCS_LOCKFILE_VERSION;
}

export interface DcsLockContractRecord {
  readonly digest: string;
}

export interface DcsLockInputRecord {
  readonly documentRevision: string;
  readonly format: DcsDocumentSyntax;
  readonly location: string;
  readonly profile?: DcsProfileName;
  readonly scope: DcsLockInputScope;
  readonly semanticRevision: string;
  readonly sourceKind: string;
}

export interface DcsLockExtensionRecord {
  readonly digest: string;
  readonly sourceKind: string;
  readonly location?: string;
  readonly profile?: DcsProfileName;
}

export interface DcsLockPolicyRecord {
  readonly digest: string;
}

export interface DcsLockEffectiveRecord {
  readonly redacted: boolean;
  readonly revision: string;
  readonly snapshot?: JsonObject;
}

export interface DcsLockfile {
  readonly $dcsLock: DcsLockfileMetadata;
  readonly contract: DcsLockContractRecord;
  readonly effective: DcsLockEffectiveRecord;
  readonly extensions: readonly DcsLockExtensionRecord[];
  readonly inputs: readonly DcsLockInputRecord[];
  readonly policy?: DcsLockPolicyRecord;
}

export interface DcsLockfileParseResult {
  readonly diagnostics: readonly DcsDiagnostic[];
  readonly lockfile?: DcsLockfile;
  readonly ok: boolean;
}

export function createDcsLockfile(input: DcsLockfile): DcsLockfile {
  const result = validateDcsLockfile(input);
  if (!result.ok || result.lockfile === undefined) {
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    throw new DcsLockfileValidationError(
      result.diagnostics,
      messages.length === 0 ? "Invalid DCS lockfile." : messages,
    );
  }
  return result.lockfile;
}

export function parseDcsLockfile(text: string): DcsLockfileParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      diagnostics: Object.freeze([diagnostic("DCS9001", "DCS lockfile is not valid JSON.")]),
      ok: false,
    };
  }
  return validateDcsLockfile(parsed);
}

export function serializeDcsLockfile(lockfile: DcsLockfile): string {
  return `${canonicalizeJson(lockfile as unknown as JsonObject)}\n`;
}

export function validateDcsLockfile(value: unknown): DcsLockfileParseResult {
  const diagnostics: DcsDiagnostic[] = [];
  if (!isJsonObject(value)) {
    diagnostics.push(diagnostic("DCS9002", "DCS lockfile must be a JSON object."));
    return { diagnostics: Object.freeze(diagnostics), ok: false };
  }

  const metadata = value.$dcsLock;
  if (!isJsonObject(metadata)) {
    diagnostics.push(
      diagnostic("DCS9003", "DCS lockfile requires a $dcsLock metadata object.", "/$dcsLock"),
    );
  }
  const contract = value.contract;
  if (!isJsonObject(contract) || typeof contract.digest !== "string") {
    diagnostics.push(
      diagnostic("DCS9004", "DCS lockfile requires contract.digest.", "/contract/digest"),
    );
  }
  const effective = value.effective;
  if (
    !isJsonObject(effective) ||
    typeof effective.revision !== "string" ||
    typeof effective.redacted !== "boolean"
  ) {
    diagnostics.push(
      diagnostic(
        "DCS9005",
        "DCS lockfile requires effective.revision and effective.redacted.",
        "/effective",
      ),
    );
  }
  if (
    isJsonObject(effective) &&
    effective.snapshot !== undefined &&
    !isJsonObject(effective.snapshot)
  ) {
    diagnostics.push(
      diagnostic(
        "DCS9006",
        "DCS effective snapshot must be a JSON object when present.",
        "/effective/snapshot",
      ),
    );
  }
  const inputs = value.inputs;
  if (!isJsonArray(inputs)) {
    diagnostics.push(diagnostic("DCS9007", "DCS lockfile requires an inputs array.", "/inputs"));
  } else {
    inputs.forEach((entry, index) => validateInputRecord(entry, `/inputs/${index}`, diagnostics));
  }
  const extensions = value.extensions;
  if (!isJsonArray(extensions)) {
    diagnostics.push(
      diagnostic("DCS9008", "DCS lockfile requires an extensions array.", "/extensions"),
    );
  } else {
    extensions.forEach((entry, index) =>
      validateExtensionRecord(entry, `/extensions/${index}`, diagnostics),
    );
  }
  const policy = value.policy;
  if (policy !== undefined && (!isJsonObject(policy) || typeof policy.digest !== "string")) {
    diagnostics.push(
      diagnostic(
        "DCS9009",
        "DCS lockfile policy must contain digest when present.",
        "/policy/digest",
      ),
    );
  }

  if (isJsonObject(metadata)) {
    if (metadata.format !== DCS_LOCKFILE_FORMAT) {
      diagnostics.push(
        diagnostic(
          "DCS9010",
          `DCS lockfile format must be ${DCS_LOCKFILE_FORMAT}.`,
          "/$dcsLock/format",
        ),
      );
    }
    if (metadata.version !== DCS_LOCKFILE_VERSION) {
      diagnostics.push(
        diagnostic(
          "DCS9011",
          `DCS lockfile version must be ${DCS_LOCKFILE_VERSION}.`,
          "/$dcsLock/version",
        ),
      );
    }
    if (typeof metadata.id !== "string")
      diagnostics.push(diagnostic("DCS9012", "DCS lockfile requires $dcsLock.id.", "/$dcsLock/id"));
    if (typeof metadata.fileStem !== "string")
      diagnostics.push(
        diagnostic("DCS9013", "DCS lockfile requires $dcsLock.fileStem.", "/$dcsLock/fileStem"),
      );
    if (typeof metadata.contractVersion !== "number")
      diagnostics.push(
        diagnostic(
          "DCS9014",
          "DCS lockfile requires numeric $dcsLock.contractVersion.",
          "/$dcsLock/contractVersion",
        ),
      );
    if (typeof metadata.documentVersion !== "number")
      diagnostics.push(
        diagnostic(
          "DCS9015",
          "DCS lockfile requires numeric $dcsLock.documentVersion.",
          "/$dcsLock/documentVersion",
        ),
      );
    if (typeof metadata.generatedBy !== "string")
      diagnostics.push(
        diagnostic(
          "DCS9016",
          "DCS lockfile requires $dcsLock.generatedBy.",
          "/$dcsLock/generatedBy",
        ),
      );
    if (
      metadata.profile !== undefined &&
      (typeof metadata.profile !== "string" || !isDcsProfileName(metadata.profile))
    ) {
      diagnostics.push(
        diagnostic(
          "DCS9017",
          "DCS lockfile profile must be a valid DCS profile name.",
          "/$dcsLock/profile",
        ),
      );
    }
  }

  if (diagnostics.some((entry) => entry.severity === "error")) {
    return { diagnostics: Object.freeze(diagnostics), ok: false };
  }

  return {
    diagnostics: Object.freeze([]),
    lockfile: freezeLockfile(value),
    ok: true,
  };
}

export class DcsLockfileValidationError extends Error {
  public readonly diagnostics: readonly DcsDiagnostic[];

  public constructor(diagnostics: readonly DcsDiagnostic[], message = "DCS lockfile is invalid.") {
    super(message);
    this.name = "DcsLockfileValidationError";
    this.diagnostics = diagnostics;
  }
}

function validateInputRecord(value: JsonValue, path: string, diagnostics: DcsDiagnostic[]): void {
  if (!isJsonObject(value)) {
    diagnostics.push(diagnostic("DCS9020", "DCS lock input record must be an object.", path));
    return;
  }
  if (value.scope !== "user" && value.scope !== "workspace" && value.scope !== "local")
    diagnostics.push(
      diagnostic(
        "DCS9021",
        "DCS lock input scope must be user, workspace, or local.",
        `${path}/scope`,
      ),
    );
  if (value.format !== "json" && value.format !== "jsonc")
    diagnostics.push(
      diagnostic("DCS9022", "DCS lock input format must be json or jsonc.", `${path}/format`),
    );
  for (const key of ["location", "sourceKind", "documentRevision", "semanticRevision"] as const) {
    if (typeof value[key] !== "string")
      diagnostics.push(diagnostic("DCS9023", `DCS lock input requires ${key}.`, `${path}/${key}`));
  }
  if (
    value.profile !== undefined &&
    (typeof value.profile !== "string" || !isDcsProfileName(value.profile))
  )
    diagnostics.push(
      diagnostic(
        "DCS9024",
        "DCS lock input profile must be valid when present.",
        `${path}/profile`,
      ),
    );
}

function validateExtensionRecord(
  value: JsonValue,
  path: string,
  diagnostics: DcsDiagnostic[],
): void {
  if (!isJsonObject(value)) {
    diagnostics.push(diagnostic("DCS9030", "DCS lock extension record must be an object.", path));
    return;
  }
  if (typeof value.digest !== "string")
    diagnostics.push(
      diagnostic("DCS9031", "DCS lock extension record requires digest.", `${path}/digest`),
    );
  if (typeof value.sourceKind !== "string")
    diagnostics.push(
      diagnostic("DCS9032", "DCS lock extension record requires sourceKind.", `${path}/sourceKind`),
    );
  if (value.location !== undefined && typeof value.location !== "string")
    diagnostics.push(
      diagnostic("DCS9033", "DCS lock extension location must be a string.", `${path}/location`),
    );
  if (
    value.profile !== undefined &&
    (typeof value.profile !== "string" || !isDcsProfileName(value.profile))
  )
    diagnostics.push(
      diagnostic(
        "DCS9034",
        "DCS lock extension profile must be valid when present.",
        `${path}/profile`,
      ),
    );
}

function freezeLockfile(value: JsonObject): DcsLockfile {
  const clone = cloneJsonValue(value);
  return Object.freeze(clone) as unknown as DcsLockfile;
}

function diagnostic(code: string, message: string, path?: string): DcsDiagnostic {
  return { code, message, ...(path === undefined ? {} : { path }), severity: "error" };
}

// Compile-time guard: a valid DCS lockfile remains JSON-compatible.
const _lockfileIsJsonValue = (value: DcsLockfile): JsonValue => {
  if (!isJsonValue(value)) {
    throw new TypeError("DCS lockfile must remain JSON-compatible.");
  }
  return value;
};
void _lockfileIsJsonValue;
