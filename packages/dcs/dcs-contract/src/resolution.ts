import { canonicalizeJson } from "./canonical";
import {
  type DcsCollectionIdentity,
  type DcsDiagnostic,
  type DcsFieldMetadata,
  type DcsScope,
  type ConfigContractBundle,
} from "./contract";
import { type ParsedConfigDocument, type DcsCollectionMove } from "./document";
import {
  cloneJsonValue,
  deleteJsonObjectPointer,
  freezeJsonValue,
  getJsonPointer,
  hasJsonPointer,
  isJsonArray,
  isJsonObject,
  setJsonObjectPointer,
  type JsonObject,
  type JsonValue,
} from "./json";
import { type DcsProfileName } from "./profiles";
import { schemaAtJsonPointer, validateJsonValueAgainstSchema } from "./schema";

export type DcsConfigSourceKind =
  | "defaults"
  | "invocation-override"
  | "local-document"
  | "local-profile-document"
  | "user-document"
  | "user-profile-document"
  | "workspace-document"
  | "workspace-profile-document";

export interface DcsConfigSource {
  readonly kind: DcsConfigSourceKind;
  readonly location?: string;
  /** Present only for explicit profile-overlay sources. */
  readonly profile?: DcsProfileName;
}

export interface DcsConfigLayerSource extends DcsConfigSource {
  readonly kind: Exclude<DcsConfigSourceKind, "defaults">;
}

export interface DcsResolutionLayer {
  readonly document: ParsedConfigDocument;
  /** One explicitly selected profile may add an overlay after its base scope. */
  readonly profile?: DcsProfileName;
  readonly scope: DcsScope;
  readonly source: DcsConfigLayerSource;
}

export type DcsProvenanceAction = "default" | "move" | "none" | "remove" | "reset" | "set";

export interface DcsProvenanceSource {
  readonly action: DcsProvenanceAction;
  readonly source: DcsConfigSource;
  readonly used: boolean;
}

export interface DcsMixedConfigSource {
  readonly kind: "mixed";
}

export type DcsEffectiveConfigSource = DcsConfigSource | DcsMixedConfigSource;

export interface DcsFieldProvenance {
  readonly consideredSources: readonly DcsProvenanceSource[];
  readonly effectiveSource: DcsEffectiveConfigSource;
  readonly path: string;
  readonly redacted: boolean;
  readonly resets: readonly DcsConfigLayerSource[];
}

export interface DcsResolvedExtensionLayer {
  readonly extensions: JsonObject;
  readonly source: DcsConfigLayerSource;
}

export interface DcsResolvedConfig {
  readonly extensions: readonly DcsResolvedExtensionLayer[];
  readonly provenance: Readonly<Record<string, DcsFieldProvenance>>;
  readonly value: JsonObject;
}

export interface ResolveConfigLayersOptions {
  readonly bundle: ConfigContractBundle;
  readonly layers: readonly DcsResolutionLayer[];
}

export interface ResolveConfigLayersResult {
  readonly diagnostics: readonly DcsDiagnostic[];
  readonly ok: boolean;
  readonly resolved?: DcsResolvedConfig;
}

const defaultsSource: DcsConfigSource = Object.freeze({ kind: "defaults" });
const mixedSource: DcsMixedConfigSource = Object.freeze({ kind: "mixed" });
const scopeOrder: Readonly<Record<DcsScope, number>> = Object.freeze({
  invocation: 7,
  local: 5,
  user: 1,
  workspace: 3,
});

export function resolveConfigLayers(
  options: ResolveConfigLayersOptions,
): ResolveConfigLayersResult {
  const diagnostics: DcsDiagnostic[] = [];
  const layers = validateAndSortLayers(options.layers, diagnostics);

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics, ok: false };
  }

  let value = cloneJsonValue(options.bundle.defaults);
  const events = new Map<string, InternalEvent[]>();
  const finalDecision = new Map<string, number | "default">();
  const sourceByPath = new Map<string, DcsEffectiveConfigSource>();
  const fieldPaths = Object.keys(options.bundle.fields).sort(
    comparePointerDepthThenLexicographically,
  );
  const eventId = createEventIdGenerator();

  for (const path of fieldPaths) {
    sourceByPath.set(path, defaultsSource);
    finalDecision.set(path, "default");
  }

  for (const layer of layers) {
    const source = layer.source;

    for (const path of [...layer.document.envelope.resets].sort(
      comparePointerDepthThenLexicographically,
    )) {
      const defaultExists = hasJsonPointer(options.bundle.defaults, path);
      if (defaultExists) {
        const defaultValue = getJsonPointer(options.bundle.defaults, path);
        if (defaultValue === undefined) {
          diagnostics.push(
            withSource(
              diag("DCS3010", `Unable to restore default for reset path ${path}.`, path),
              source,
            ),
          );
          continue;
        }
        value = setJsonObjectPointer(value, path, defaultValue);
      } else {
        value = deleteJsonObjectPointer(value, path);
      }

      for (const affectedPath of descendantFieldPaths(fieldPaths, path)) {
        const event = addEvent(events, eventId(), "reset", source, affectedPath);
        sourceByPath.set(affectedPath, defaultsSource);
        finalDecision.set(affectedPath, event.id);
      }
    }

    for (const [path, identities] of Object.entries(
      layer.document.envelope.collectionRemovals,
    ).sort(([left], [right]) => comparePointerDepthThenLexicographically(left, right))) {
      const result = applyCollectionRemovals({
        bundle: options.bundle,
        diagnostics,
        events,
        eventId,
        finalDecision,
        path,
        source,
        sourceByPath,
        value,
        identities,
      });
      value = result.workingValue;
    }

    for (const [key, explicitValue] of Object.entries(layer.document.product)) {
      const result = applyFieldValue({
        bundle: options.bundle,
        diagnostics,
        events,
        eventId,
        fieldPaths,
        finalDecision,
        path: `/${escapeSegment(key)}`,
        source,
        sourceByPath,
        value: explicitValue,
        workingValue: value,
      });
      value = result.workingValue;
    }

    for (const [path, moves] of Object.entries(layer.document.envelope.collectionMoves).sort(
      ([left], [right]) => comparePointerDepthThenLexicographically(left, right),
    )) {
      const result = applyCollectionMoves({
        bundle: options.bundle,
        diagnostics,
        events,
        eventId,
        finalDecision,
        moves,
        path,
        source,
        sourceByPath,
        value,
      });
      value = result.workingValue;
    }
  }

  for (const issue of validateJsonValueAgainstSchema(value, options.bundle.schema, "")) {
    diagnostics.push(
      diag("DCS3011", `Resolved configuration is invalid: ${issue.message}`, issue.path),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics, ok: false };
  }

  const provenance = buildProvenance({
    bundle: options.bundle,
    events,
    fieldPaths,
    finalDecision,
    layers,
    sourceByPath,
  });

  return {
    diagnostics,
    ok: true,
    resolved: Object.freeze({
      extensions: Object.freeze(
        layers
          .filter((layer) => Object.keys(layer.document.extensions).length > 0)
          .map((layer) =>
            Object.freeze({
              extensions: freezeJsonValue(cloneJsonValue(layer.document.extensions)),
              source: Object.freeze({ ...layer.source }),
            }),
          ),
      ),
      provenance: Object.freeze(provenance),
      value: freezeJsonValue(value),
    }),
  };
}

export function explainConfigPath(
  resolved: DcsResolvedConfig,
  path: string,
): DcsFieldProvenance | undefined {
  return resolved.provenance[path];
}

function applyFieldValue(input: ApplyFieldInput): ApplyFieldResult {
  const metadata = input.bundle.fields[input.path];
  if (metadata === undefined) {
    return { workingValue: input.workingValue };
  }

  const schema = schemaForField(input.bundle, input.path);
  if (
    metadata.merge === "deep" &&
    isJsonObject(input.value) &&
    schema !== undefined &&
    isJsonObject(schema.properties)
  ) {
    let workingValue = input.workingValue;
    for (const [key, child] of Object.entries(input.value)) {
      const result = applyFieldValue({
        ...input,
        path: `${input.path}/${escapeSegment(key)}`,
        value: child,
        workingValue,
      });
      workingValue = result.workingValue;
    }

    return { workingValue };
  }

  if (isCollectionMerge(metadata.merge) && isJsonArray(input.value)) {
    const current = getJsonPointer(input.workingValue, input.path);
    if (!isJsonArray(current)) {
      input.diagnostics.push(
        withSource(
          diag(
            "DCS3020",
            `Collection field ${input.path} must resolve from an array before ${metadata.merge} merge.`,
            input.path,
          ),
          input.source,
        ),
      );
      return { workingValue: input.workingValue };
    }
    const merged = mergeCollection({
      existing: current,
      incoming: input.value,
      metadata,
      path: input.path,
      diagnostics: input.diagnostics,
      source: input.source,
    });
    const workingValue = setJsonObjectPointer(input.workingValue, input.path, merged);
    const event = addEvent(input.events, input.eventId(), "set", input.source, input.path);
    input.finalDecision.set(input.path, event.id);
    input.sourceByPath.set(
      input.path,
      sourceAfterCollectionMerge(
        input.sourceByPath.get(input.path) ?? defaultsSource,
        input.source,
        current,
        input.value,
      ),
    );
    return { workingValue };
  }

  const workingValue = setJsonObjectPointer(input.workingValue, input.path, input.value);
  for (const affectedPath of descendantFieldPaths(input.fieldPaths, input.path)) {
    const event = addEvent(input.events, input.eventId(), "set", input.source, affectedPath);
    input.sourceByPath.set(affectedPath, input.source);
    input.finalDecision.set(affectedPath, event.id);
  }

  return { workingValue };
}

function applyCollectionRemovals(input: {
  readonly bundle: ConfigContractBundle;
  readonly diagnostics: DcsDiagnostic[];
  readonly events: Map<string, InternalEvent[]>;
  readonly eventId: () => number;
  readonly finalDecision: Map<string, number | "default">;
  readonly identities: readonly DcsCollectionIdentity[];
  readonly path: string;
  readonly source: DcsConfigLayerSource;
  readonly sourceByPath: Map<string, DcsEffectiveConfigSource>;
  readonly value: JsonObject;
}): ApplyFieldResult {
  const metadata = input.bundle.fields[input.path];
  const identityPointer = metadata?.collection?.identity;
  const current = getJsonPointer(input.value, input.path);
  if (
    metadata === undefined ||
    !isIdentityAwareCollection(metadata) ||
    identityPointer === undefined ||
    !isJsonArray(current)
  ) {
    input.diagnostics.push(
      withSource(
        diag(
          "DCS3021",
          `Collection removals require an identity-aware collection at ${input.path}.`,
          input.path,
        ),
        input.source,
      ),
    );
    return { workingValue: input.value };
  }

  const removed = new Set(input.identities.map(collectionIdentityKey));
  const retained = current.filter((item) => {
    const identity = collectionIdentity(item, identityPointer);
    return identity === undefined || !removed.has(collectionIdentityKey(identity));
  });
  const workingValue = setJsonObjectPointer(input.value, input.path, retained);
  const event = addEvent(input.events, input.eventId(), "remove", input.source, input.path);
  input.finalDecision.set(input.path, event.id);
  input.sourceByPath.set(input.path, retained.length === 0 ? input.source : mixedSource);
  return { workingValue };
}

function applyCollectionMoves(input: {
  readonly bundle: ConfigContractBundle;
  readonly diagnostics: DcsDiagnostic[];
  readonly events: Map<string, InternalEvent[]>;
  readonly eventId: () => number;
  readonly finalDecision: Map<string, number | "default">;
  readonly moves: readonly DcsCollectionMove[];
  readonly path: string;
  readonly source: DcsConfigLayerSource;
  readonly sourceByPath: Map<string, DcsEffectiveConfigSource>;
  readonly value: JsonObject;
}): ApplyFieldResult {
  const metadata = input.bundle.fields[input.path];
  const identityPointer = metadata?.collection?.identity;
  const current = getJsonPointer(input.value, input.path);
  if (
    metadata === undefined ||
    !isIdentityAwareCollection(metadata) ||
    identityPointer === undefined ||
    !isJsonArray(current)
  ) {
    input.diagnostics.push(
      withSource(
        diag(
          "DCS3022",
          `Collection moves require an identity-aware collection at ${input.path}.`,
          input.path,
        ),
        input.source,
      ),
    );
    return { workingValue: input.value };
  }

  let items = [...current];
  for (const move of input.moves) {
    const from = items.findIndex((item) => collectionIdentity(item, identityPointer) === move.id);
    if (from === -1) {
      input.diagnostics.push(
        withSource(
          diag(
            "DCS3023",
            `Collection item ${JSON.stringify(move.id)} does not exist at ${input.path}.`,
            input.path,
          ),
          input.source,
        ),
      );
      continue;
    }
    const [item] = items.splice(from, 1);
    const to =
      move.before === undefined
        ? items.length
        : items.findIndex(
            (candidate) => collectionIdentity(candidate, identityPointer) === move.before,
          );
    if (to === -1) {
      input.diagnostics.push(
        withSource(
          diag(
            "DCS3024",
            `Collection before item ${JSON.stringify(move.before)} does not exist at ${input.path}.`,
            input.path,
          ),
          input.source,
        ),
      );
      items.splice(from, 0, item!);
      continue;
    }
    items.splice(to, 0, item!);
  }
  const workingValue = setJsonObjectPointer(input.value, input.path, items);
  const event = addEvent(input.events, input.eventId(), "move", input.source, input.path);
  input.finalDecision.set(input.path, event.id);
  input.sourceByPath.set(input.path, mixedSource);
  return { workingValue };
}

function mergeCollection(input: {
  readonly diagnostics: DcsDiagnostic[];
  readonly existing: readonly JsonValue[];
  readonly incoming: readonly JsonValue[];
  readonly metadata: DcsFieldMetadata;
  readonly path: string;
  readonly source: DcsConfigLayerSource;
}): JsonValue[] {
  if (input.metadata.merge === "append") {
    return [...input.existing.map(cloneJsonValue), ...input.incoming.map(cloneJsonValue)];
  }

  const identityPointer = input.metadata.collection?.identity;
  const keyFor = (item: JsonValue): string | undefined => {
    if (identityPointer !== undefined) {
      const identity = collectionIdentity(item, identityPointer);
      if (identity === undefined) {
        input.diagnostics.push(
          withSource(
            diag(
              "DCS3025",
              `Collection item at ${input.path} is missing identity ${identityPointer}.`,
              input.path,
            ),
            input.source,
          ),
        );
        return undefined;
      }
      return collectionIdentityKey(identity);
    }
    return canonicalizeJson(item);
  };

  const result = input.existing.map(cloneJsonValue);
  const indexes = new Map<string, number>();
  for (let index = 0; index < result.length; index += 1) {
    const key = keyFor(result[index]!);
    if (key === undefined) {
      continue;
    }
    if (indexes.has(key)) {
      input.diagnostics.push(
        withSource(
          diag(
            "DCS3026",
            `Collection ${input.path} contains duplicate identity ${JSON.stringify(key)}.`,
            input.path,
          ),
          input.source,
        ),
      );
      continue;
    }
    indexes.set(key, index);
  }

  for (const item of input.incoming) {
    const key = keyFor(item);
    if (key === undefined) {
      continue;
    }
    const existingIndex = indexes.get(key);
    if (existingIndex === undefined) {
      indexes.set(key, result.length);
      result.push(cloneJsonValue(item));
      continue;
    }
    result[existingIndex] =
      input.metadata.merge === "keyed"
        ? mergeKeyedItem(result[existingIndex]!, item)
        : cloneJsonValue(item);
  }
  return result;
}

function mergeKeyedItem(lower: JsonValue, higher: JsonValue): JsonValue {
  if (!isJsonObject(lower) || !isJsonObject(higher)) {
    return cloneJsonValue(higher);
  }
  const result: Record<string, JsonValue> = { ...cloneJsonValue(lower) };
  for (const [key, value] of Object.entries(higher)) {
    const prior = Object.hasOwn(result, key) ? result[key] : undefined;
    Object.defineProperty(result, key, {
      value:
        isJsonObject(prior) && isJsonObject(value)
          ? mergeKeyedItem(prior, value)
          : cloneJsonValue(value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function isCollectionMerge(value: string): value is "append" | "unique" | "keyed" {
  return value === "append" || value === "unique" || value === "keyed";
}

function isIdentityAwareCollection(metadata: DcsFieldMetadata): boolean {
  return (
    (metadata.merge === "keyed" || metadata.merge === "unique") &&
    metadata.collection?.identity !== undefined
  );
}

function collectionIdentity(item: JsonValue, pointer: string): DcsCollectionIdentity | undefined {
  const value = getJsonPointer(item, pointer);
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function collectionIdentityKey(identity: DcsCollectionIdentity): string {
  return `${typeof identity}:${String(identity)}`;
}

function sourceAfterCollectionMerge(
  prior: DcsEffectiveConfigSource,
  source: DcsConfigLayerSource,
  existing: readonly JsonValue[],
  incoming: readonly JsonValue[],
): DcsEffectiveConfigSource {
  if (existing.length === 0 || incoming.length === 0) {
    return incoming.length === 0 ? prior : source;
  }
  if (prior.kind === "mixed" || !sourcesEqual(prior, source)) {
    return mixedSource;
  }
  return source;
}

function validateAndSortLayers(
  input: readonly DcsResolutionLayer[],
  diagnostics: DcsDiagnostic[],
): readonly DcsResolutionLayer[] {
  const identities = new Set<string>();
  const selectedProfiles = new Set<string>();

  for (const layer of input) {
    if (!isDcsScope(layer.scope)) {
      diagnostics.push(
        withSource(
          diag("DCS3007", `Unsupported resolution layer scope ${JSON.stringify(layer.scope)}.`),
          layer.source,
        ),
      );
      continue;
    }

    const profile = layer.profile;
    const identity = `${layer.scope}\u0000${profile ?? ""}`;
    if (identities.has(identity)) {
      diagnostics.push(
        withSource(
          diag(
            "DCS3008",
            `Only one selected ${profile === undefined ? "base" : `profile ${JSON.stringify(profile)}`} document may represent ${layer.scope} scope.`,
          ),
          layer.source,
        ),
      );
    }
    identities.add(identity);

    if (profile !== layer.source.profile) {
      diagnostics.push(
        withSource(
          diag("DCS3012", "Resolution layer profile must match its source profile.", undefined),
          layer.source,
        ),
      );
    }
    if (profile !== undefined) {
      selectedProfiles.add(profile);
      if (layer.scope === "invocation") {
        diagnostics.push(
          withSource(
            diag("DCS3013", "Invocation overrides cannot be profile overlays."),
            layer.source,
          ),
        );
      }
      if (layer.document.envelope.profile !== profile) {
        diagnostics.push(
          withSource(
            diag(
              "DCS3014",
              `Profile layer document must declare $dcs.profile ${JSON.stringify(profile)}.`,
            ),
            layer.source,
          ),
        );
      }
    } else if (layer.document.envelope.profile !== undefined) {
      diagnostics.push(
        withSource(
          diag("DCS3015", "Base resolution layers must not declare $dcs.profile."),
          layer.source,
        ),
      );
    }

    const expectedKind = expectedSourceKind(layer.scope, profile);
    if (layer.source.kind !== expectedKind) {
      diagnostics.push(
        withSource(
          diag(
            "DCS3009",
            `Source kind ${layer.source.kind} is incompatible with ${profile === undefined ? "base" : "profile"} ${layer.scope} scope.`,
          ),
          layer.source,
        ),
      );
    }
  }

  if (selectedProfiles.size > 1) {
    diagnostics.push(diag("DCS3016", "A DCS resolution may select at most one profile."));
  }

  return [...input].sort((left, right) => {
    const order = scopeOrder[left.scope] - scopeOrder[right.scope];
    if (order !== 0) {
      return order;
    }
    return (left.profile === undefined ? 0 : 1) - (right.profile === undefined ? 0 : 1);
  });
}

function buildProvenance(input: BuildProvenanceInput): Record<string, DcsFieldProvenance> {
  const provenance: Record<string, DcsFieldProvenance> = {};

  for (const path of input.fieldPaths) {
    const metadata = input.bundle.fields[path];
    if (metadata === undefined) {
      continue;
    }

    const descendants = descendantFieldPaths(input.fieldPaths, path).filter(
      (candidatePath) => candidatePath !== path,
    );
    const relevantPaths =
      metadata.merge === "deep" && descendants.length > 0 ? descendants : [path];
    const effectiveSources = relevantPaths.map(
      (candidatePath) => input.sourceByPath.get(candidatePath) ?? defaultsSource,
    );
    const effectiveSource = readEffectiveSource(effectiveSources);
    const relevantEvents = relevantPaths.flatMap(
      (candidatePath) => input.events.get(candidatePath) ?? [],
    );
    const lastDecisions = new Set(
      relevantPaths.map((candidatePath) => input.finalDecision.get(candidatePath) ?? "default"),
    );
    const resets = uniqueSources(
      relevantEvents.filter((event) => event.action === "reset").map((event) => event.source),
    );

    provenance[path] = Object.freeze({
      consideredSources: Object.freeze([
        Object.freeze({
          action: "default" as const,
          source: defaultsSource,
          used: effectiveSources.some((source) => sourcesEqual(source, defaultsSource)),
        }),
        ...input.layers.map((layer) => {
          const layerEvents = relevantEvents.filter((event) =>
            sourcesEqual(event.source, layer.source),
          );
          const latest = layerEvents.at(-1);
          return Object.freeze({
            action: latest?.action ?? "none",
            source: Object.freeze({ ...layer.source }),
            used:
              latest === undefined
                ? false
                : lastDecisions.has(latest.id) ||
                  sourceUsedInEffectiveValue(effectiveSources, layer.source),
          });
        }),
      ]),
      effectiveSource,
      path,
      redacted: Boolean(metadata.secret),
      resets: Object.freeze(resets.map((source) => Object.freeze({ ...source }))),
    });
  }

  return provenance;
}

function readEffectiveSource(
  sources: readonly DcsEffectiveConfigSource[],
): DcsEffectiveConfigSource {
  const first = sources[0] ?? defaultsSource;
  if (first.kind === "mixed") {
    return mixedSource;
  }
  return sources.every((source) => source.kind !== "mixed" && sourcesEqual(source, first))
    ? Object.freeze({ ...first })
    : mixedSource;
}

function sourceUsedInEffectiveValue(
  effectiveSources: readonly DcsEffectiveConfigSource[],
  target: DcsConfigLayerSource,
): boolean {
  return effectiveSources.some((source) => source.kind === "mixed" || sourcesEqual(source, target));
}

function uniqueSources(sources: readonly DcsConfigLayerSource[]): readonly DcsConfigLayerSource[] {
  const unique = new Map<string, DcsConfigLayerSource>();
  for (const source of sources) {
    unique.set(sourceKey(source), source);
  }
  return [...unique.values()];
}

function descendantFieldPaths(fieldPaths: readonly string[], path: string): readonly string[] {
  return fieldPaths.filter((candidate) => candidate === path || candidate.startsWith(`${path}/`));
}

function schemaForField(bundle: ConfigContractBundle, path: string): JsonObject | undefined {
  return schemaAtJsonPointer(bundle.schema, path);
}

function addEvent(
  events: Map<string, InternalEvent[]>,
  id: number,
  action: Exclude<DcsProvenanceAction, "default" | "none">,
  source: DcsConfigLayerSource,
  path: string,
): InternalEvent {
  const event: InternalEvent = { action, id, source };
  const pathEvents = events.get(path) ?? [];
  pathEvents.push(event);
  events.set(path, pathEvents);
  return event;
}

function createEventIdGenerator(): () => number {
  let current = 0;
  return () => {
    current += 1;
    return current;
  };
}

function comparePointerDepthThenLexicographically(left: string, right: string): number {
  const depth = pointerDepth(left) - pointerDepth(right);
  return depth === 0 ? left.localeCompare(right) : depth;
}

function pointerDepth(path: string): number {
  return path === "" ? 0 : path.split("/").length - 1;
}

function expectedSourceKind(
  scope: DcsScope,
  profile: DcsProfileName | undefined,
): DcsConfigLayerSource["kind"] {
  if (scope === "invocation") {
    return "invocation-override";
  }
  if (profile === undefined) {
    return scope === "local"
      ? "local-document"
      : scope === "user"
        ? "user-document"
        : "workspace-document";
  }
  return scope === "local"
    ? "local-profile-document"
    : scope === "user"
      ? "user-profile-document"
      : "workspace-profile-document";
}

function isDcsScope(value: string): value is DcsScope {
  return value === "user" || value === "workspace" || value === "local" || value === "invocation";
}

function sourcesEqual(left: DcsEffectiveConfigSource, right: DcsEffectiveConfigSource): boolean {
  return left.kind !== "mixed" && right.kind !== "mixed" && sourceKey(left) === sourceKey(right);
}

function sourceKey(source: DcsConfigSource): string {
  return `${source.kind}\u0000${source.profile ?? ""}\u0000${source.location ?? ""}`;
}

function escapeSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function withSource(diagnostic: DcsDiagnostic, source: DcsConfigLayerSource): DcsDiagnostic {
  return { ...diagnostic, source };
}

function diag(code: string, message: string, path?: string): DcsDiagnostic {
  return { code, message, ...(path === undefined ? {} : { path }), severity: "error" };
}

interface InternalEvent {
  readonly action: "move" | "remove" | "reset" | "set";
  readonly id: number;
  readonly source: DcsConfigLayerSource;
}

interface ApplyFieldInput {
  readonly bundle: ConfigContractBundle;
  readonly diagnostics: DcsDiagnostic[];
  readonly eventId: () => number;
  readonly events: Map<string, InternalEvent[]>;
  readonly fieldPaths: readonly string[];
  readonly finalDecision: Map<string, number | "default">;
  readonly path: string;
  readonly source: DcsConfigLayerSource;
  readonly sourceByPath: Map<string, DcsEffectiveConfigSource>;
  readonly value: JsonValue;
  readonly workingValue: JsonObject;
}

interface ApplyFieldResult {
  readonly workingValue: JsonObject;
}

interface BuildProvenanceInput {
  readonly bundle: ConfigContractBundle;
  readonly events: Map<string, InternalEvent[]>;
  readonly fieldPaths: readonly string[];
  readonly finalDecision: Map<string, number | "default">;
  readonly layers: readonly DcsResolutionLayer[];
  readonly sourceByPath: Map<string, DcsEffectiveConfigSource>;
}
