import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveRvsPrivateRootTopology } from "@reliverse/rvs-private";

import { GrError } from "./error";
import { resolveGrPrivatePath } from "./private-root";
import { GR_HARD_BUNDLE_EXCLUDES } from "./public-surface";

export const GR_BUNDLE_POLICY_SCHEMA_VERSION = "gr.bundle-policy.v0" as const;
export type GrBundleHistoryMode = "none" | "refs" | "commits";

export interface GrBundleHandoffPolicyV0 {
  readonly enabled: boolean;
  readonly global: boolean;
  readonly root?: string;
}

export interface GrBundleOutputPolicyV0 {
  readonly timestampDirectory: "short" | "none";
  readonly naming: "handoff" | "snapshot";
}

export interface GrBundleToolingPolicyV0 {
  readonly mode: "auto" | "none";
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly versions: Readonly<Record<string, string>>;
}

export interface GrBundlePolicyV0 {
  readonly schemaVersion: typeof GR_BUNDLE_POLICY_SCHEMA_VERSION;
  readonly exclude: readonly string[];
  readonly history: GrBundleHistoryMode;
  readonly profile: "source" | "handoff" | "offline";
  readonly handoff: GrBundleHandoffPolicyV0;
  readonly output: GrBundleOutputPolicyV0;
  readonly tooling: GrBundleToolingPolicyV0;
  readonly sources: readonly string[];
}

const HARD_EXCLUDES = GR_HARD_BUNDLE_EXCLUDES;

function normalizeGlob(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "").trim();
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR bundle exclude globs must be repository-relative and must not traverse parents.",
      { value },
    );
  }
  return normalized;
}

function parseConfigValue(
  value: any,
  source: string,
):
  | {
      exclude: string[];
      history?: GrBundleHistoryMode;
      profile?: "source" | "handoff" | "offline";
      handoff?: Partial<GrBundleHandoffPolicyV0>;
      output?: Partial<GrBundleOutputPolicyV0>;
      tooling?: Partial<GrBundleToolingPolicyV0>;
    }
  | undefined {
  const bundle = value?.bundle;
  if (bundle === undefined) return undefined;
  try {
    if (!bundle || typeof bundle !== "object" || Array.isArray(bundle))
      throw new Error("bundle must be an object");
    const exclude = bundle.exclude === undefined ? [] : bundle.exclude;
    if (!Array.isArray(exclude) || exclude.some((item: unknown) => typeof item !== "string"))
      throw new Error("bundle.exclude must be an array of strings");
    const history = bundle.history as GrBundleHistoryMode | undefined;
    if (history !== undefined && !["none", "refs", "commits"].includes(history))
      throw new Error("bundle.history must be none, refs, or commits");
    const profile = bundle.profile as "source" | "handoff" | "offline" | undefined;
    if (profile !== undefined && !["source", "handoff", "offline"].includes(profile))
      throw new Error("bundle.profile must be source, handoff, or offline");
    let handoff: Partial<GrBundleHandoffPolicyV0> | undefined;
    if (bundle.handoff !== undefined) {
      if (!bundle.handoff || typeof bundle.handoff !== "object" || Array.isArray(bundle.handoff))
        throw new Error("bundle.handoff must be an object");
      if (bundle.handoff.enabled !== undefined && typeof bundle.handoff.enabled !== "boolean")
        throw new Error("bundle.handoff.enabled must be boolean");
      if (bundle.handoff.global !== undefined && typeof bundle.handoff.global !== "boolean")
        throw new Error("bundle.handoff.global must be boolean");
      if (bundle.handoff.root !== undefined && typeof bundle.handoff.root !== "string")
        throw new Error("bundle.handoff.root must be a string");
      handoff = {
        ...(bundle.handoff.enabled === undefined ? {} : { enabled: bundle.handoff.enabled }),
        ...(bundle.handoff.global === undefined ? {} : { global: bundle.handoff.global }),
        ...(bundle.handoff.root?.trim() ? { root: bundle.handoff.root.trim() } : {}),
      };
    }
    let output: Partial<GrBundleOutputPolicyV0> | undefined;
    if (bundle.output !== undefined) {
      if (!bundle.output || typeof bundle.output !== "object" || Array.isArray(bundle.output))
        throw new Error("bundle.output must be an object");
      const timestampDirectory = bundle.output.timestampDirectory;
      if (timestampDirectory !== undefined && !["short", "none"].includes(timestampDirectory))
        throw new Error("bundle.output.timestampDirectory must be short or none");
      const naming = bundle.output.naming;
      if (naming !== undefined && !["handoff", "snapshot"].includes(naming))
        throw new Error("bundle.output.naming must be handoff or snapshot");
      output = {
        ...(timestampDirectory ? { timestampDirectory } : {}),
        ...(naming ? { naming } : {}),
      };
    }
    let tooling: Partial<GrBundleToolingPolicyV0> | undefined;
    if (bundle.tooling !== undefined) {
      if (!bundle.tooling || typeof bundle.tooling !== "object" || Array.isArray(bundle.tooling))
        throw new Error("bundle.tooling must be an object");
      const mode = bundle.tooling.mode;
      if (mode !== undefined && !["auto", "none"].includes(mode))
        throw new Error("bundle.tooling.mode must be auto or none");
      const include = bundle.tooling.include === undefined ? undefined : bundle.tooling.include;
      const toolingExclude =
        bundle.tooling.exclude === undefined ? undefined : bundle.tooling.exclude;
      if (
        include !== undefined &&
        (!Array.isArray(include) || include.some((item: unknown) => typeof item !== "string"))
      )
        throw new Error("bundle.tooling.include must be an array of strings");
      if (
        toolingExclude !== undefined &&
        (!Array.isArray(toolingExclude) ||
          toolingExclude.some((item: unknown) => typeof item !== "string"))
      )
        throw new Error("bundle.tooling.exclude must be an array of strings");
      const versions = bundle.tooling.versions;
      if (
        versions !== undefined &&
        (!versions ||
          typeof versions !== "object" ||
          Array.isArray(versions) ||
          Object.values(versions).some((item) => typeof item !== "string"))
      )
        throw new Error("bundle.tooling.versions must be an object of strings");
      tooling = {
        ...(mode ? { mode } : {}),
        ...(include ? { include: include.map((item: string) => item.trim()).filter(Boolean) } : {}),
        ...(toolingExclude
          ? { exclude: toolingExclude.map((item: string) => item.trim()).filter(Boolean) }
          : {}),
        ...(versions
          ? {
              versions: Object.fromEntries(
                Object.entries(versions).map(([key, value]) => [key.trim(), String(value).trim()]),
              ),
            }
          : {}),
      };
    }
    return {
      exclude: exclude.map(normalizeGlob),
      ...(history ? { history } : {}),
      ...(profile ? { profile } : {}),
      ...(handoff ? { handoff } : {}),
      ...(output ? { output } : {}),
      ...(tooling ? { tooling } : {}),
    };
  } catch (error: any) {
    throw new GrError("GR_INVALID_ARTIFACT", `Invalid GR configuration: ${source}`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readConfig(file: string) {
  try {
    return parseConfigValue(JSON.parse(await readFile(file, "utf8")), file);
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    if (error instanceof GrError) throw error;
    throw new GrError("GR_INVALID_ARTIFACT", `Invalid GR configuration: ${file}`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function resolveGrBundlePolicy(
  root: string,
  options: { readonly repositoryConfigText?: string | null } = {},
): Promise<GrBundlePolicyV0> {
  const resolvedRoot = path.resolve(root);
  const topology = resolveRvsPrivateRootTopology({ workspaceRoot: resolvedRoot });
  const globalFile = path.join(topology.reliverseHome, "config", "gr.json");
  const privateFile = resolveGrPrivatePath(resolvedRoot, "config.json");
  const sources: string[] = [];
  const exclude = new Set<string>(HARD_EXCLUDES);
  let history: GrBundleHistoryMode = "refs";
  let profile: "source" | "handoff" | "offline" = "offline";
  let handoff: GrBundleHandoffPolicyV0 = { enabled: false, global: true };
  let output: GrBundleOutputPolicyV0 = { timestampDirectory: "short", naming: "handoff" };
  let tooling: GrBundleToolingPolicyV0 = { mode: "auto", include: [], exclude: [], versions: {} };
  const apply = (config: ReturnType<typeof parseConfigValue>, source: string) => {
    if (!config) return;
    sources.push(source);
    for (const pattern of config.exclude) exclude.add(pattern);
    if (config.history) history = config.history;
    if (config.profile) profile = config.profile;
    if (config.handoff) handoff = { ...handoff, ...config.handoff };
    if (config.output) output = { ...output, ...config.output };
    if (config.tooling) tooling = { ...tooling, ...config.tooling };
  };
  apply(await readConfig(globalFile), "global:~/.reliverse/config/gr.json");
  if (options.repositoryConfigText !== undefined) {
    apply(
      options.repositoryConfigText === null
        ? undefined
        : parseConfigValue(JSON.parse(options.repositoryConfigText), ".config/gr.json"),
      ".config/gr.json",
    );
  } else apply(await readConfig(path.join(resolvedRoot, ".config", "gr.json")), ".config/gr.json");
  apply(await readConfig(privateFile), `private:${privateFile}`);
  return {
    schemaVersion: GR_BUNDLE_POLICY_SCHEMA_VERSION,
    exclude: [...exclude].sort(),
    history,
    profile,
    handoff,
    output,
    tooling,
    sources,
  };
}

function globToRegExp(glob: string): RegExp {
  let source = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (char === "*") {
      if (glob[index + 1] === "*") {
        index += 1;
        source += ".*";
      } else source += "[^/]*";
    } else if (char === "?") source += "[^/]";
    else source += char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`${source}$`, "u");
}

export function grBundlePathExcluded(relativePath: string, policy: GrBundlePolicyV0): boolean {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//u, "");
  return policy.exclude.some(
    (pattern) =>
      globToRegExp(pattern).test(normalized) ||
      (pattern.endsWith("/**") && normalized === pattern.slice(0, -3)),
  );
}
