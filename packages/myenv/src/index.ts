export type RuntimeKind = "bun" | "node" | "deno" | "browser" | "worker" | "unknown";
export type ExecutionContextKind = "server" | "browser-main" | "web-worker" | "unknown";
export type PlatformKind =
  | "linux"
  | "darwin"
  | "windows"
  | "android"
  | "ios"
  | "freebsd"
  | "openbsd"
  | "netbsd"
  | "sunos"
  | "aix"
  | "browser"
  | "unknown";
export type StreamName = "stdout" | "stderr";
export type ColorSupportLevel = 0 | 1 | 2 | 3;
export type ColorFlagName = "always" | "auto" | "false" | "never" | "truecolor" | "256";

export interface MinimalStream {
  readonly isTTY?: boolean | undefined;
  readonly getColorDepth?: (() => number) | undefined;
  readonly hasColors?: ((count?: number) => boolean) | undefined;
}

export interface MinimalProcessLike {
  readonly argv?: readonly string[] | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly platform?: string | undefined;
  readonly stderr?: MinimalStream | undefined;
  readonly stdout?: MinimalStream | undefined;
  readonly versions?: Record<string, string | undefined> | undefined;
}

export interface MinimalDenoLike {
  readonly args?: readonly string[] | undefined;
  readonly build?: { readonly os?: string | undefined } | undefined;
  readonly version?: { readonly deno?: string | undefined } | undefined;
}

export interface MinimalNavigatorLike {
  readonly platform?: string | undefined;
  readonly userAgentData?: { readonly platform?: string | undefined } | undefined;
}

export interface DetectOptions {
  readonly argv?: readonly string[] | undefined;
  readonly browserDocument?: unknown;
  readonly browserWindow?: unknown;
  readonly deno?: MinimalDenoLike | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly explicitColor?: boolean | ColorSupportLevel | undefined;
  readonly navigator?: MinimalNavigatorLike | undefined;
  readonly process?: MinimalProcessLike | undefined;
  readonly stderr?: MinimalStream | undefined;
  readonly stdout?: MinimalStream | undefined;
  readonly workerGlobalScope?: unknown;
}

export interface EnvHints {
  readonly ci: boolean;
  readonly colorFlag: ColorFlagName | undefined;
  readonly forceColor: string | undefined;
  readonly hasProcess: boolean;
  readonly noColor: boolean;
  readonly nodeDisableColors: boolean;
}

export interface TerminalChannelSupport {
  readonly isTTY: boolean;
  readonly level: ColorSupportLevel;
}

export interface TerminalSupportSnapshot {
  readonly stderr: TerminalChannelSupport;
  readonly stdout: TerminalChannelSupport;
}

export interface MyEnvSnapshot {
  readonly executionContext: ExecutionContextKind;
  readonly hasProcess: boolean;
  readonly hints: EnvHints;
  readonly platform: PlatformKind;
  readonly runtime: RuntimeKind;
  readonly terminal: TerminalSupportSnapshot;
}

interface ResolvedDetectOptions {
  readonly argv: readonly string[];
  readonly browserDocument: unknown;
  readonly browserWindow: unknown;
  readonly deno: MinimalDenoLike | undefined;
  readonly env: Record<string, string | undefined>;
  readonly explicitColor?: boolean | ColorSupportLevel | undefined;
  readonly navigator: MinimalNavigatorLike | undefined;
  readonly process: MinimalProcessLike | undefined;
  readonly stderr: MinimalStream | undefined;
  readonly stdout: MinimalStream | undefined;
  readonly workerGlobalScope: unknown;
}

const COLOR_FLAG_PREFIX = "--color=";
const globalRef = globalThis as Record<string, unknown>;
let memoizedSnapshot: MyEnvSnapshot | undefined;

function hasOwn<TKey extends string>(value: object | undefined, key: TKey): value is Record<TKey, unknown> {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function getGlobalProcess(): MinimalProcessLike | undefined {
  return globalRef.process as MinimalProcessLike | undefined;
}

function getGlobalDeno(): MinimalDenoLike | undefined {
  return globalRef.Deno as MinimalDenoLike | undefined;
}

function getGlobalNavigator(): MinimalNavigatorLike | undefined {
  return globalRef.navigator as MinimalNavigatorLike | undefined;
}

function resolveOptions(options?: DetectOptions): ResolvedDetectOptions {
  const processLike = hasOwn(options, "process") ? options.process : getGlobalProcess();
  const denoLike = hasOwn(options, "deno") ? options.deno : getGlobalDeno();

  return {
    argv: hasOwn(options, "argv") ? options.argv ?? [] : processLike?.argv ?? denoLike?.args ?? [],
    browserDocument: hasOwn(options, "browserDocument") ? options.browserDocument : globalRef.document,
    browserWindow: hasOwn(options, "browserWindow") ? options.browserWindow : globalRef.window,
    deno: denoLike,
    env: hasOwn(options, "env") ? options.env ?? {} : processLike?.env ?? {},
    explicitColor: options?.explicitColor,
    navigator: hasOwn(options, "navigator") ? options.navigator : getGlobalNavigator(),
    process: processLike,
    stderr: hasOwn(options, "stderr") ? options.stderr : processLike?.stderr,
    stdout: hasOwn(options, "stdout") ? options.stdout : processLike?.stdout,
    workerGlobalScope: hasOwn(options, "workerGlobalScope") ? options.workerGlobalScope : globalRef.WorkerGlobalScope,
  };
}

function isTruthyEnv(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

function normalizePlatform(value: string | undefined): PlatformKind {
  switch ((value ?? "").toLowerCase()) {
    case "linux":
      return "linux";
    case "darwin":
      return "darwin";
    case "win32":
    case "windows":
      return "windows";
    case "android":
      return "android";
    case "ios":
      return "ios";
    case "freebsd":
      return "freebsd";
    case "openbsd":
      return "openbsd";
    case "netbsd":
      return "netbsd";
    case "sunos":
      return "sunos";
    case "aix":
      return "aix";
    default:
      return "unknown";
  }
}

function getColorLevelFromDepth(depth: number | undefined): ColorSupportLevel {
  if (!depth || depth <= 1) {
    return 0;
  }

  if (depth >= 24) {
    return 3;
  }

  if (depth >= 8) {
    return 2;
  }

  return 1;
}

function getNativeStreamColorLevel(stream: MinimalStream | undefined): ColorSupportLevel | undefined {
  if (!stream) {
    return undefined;
  }

  if (!stream.isTTY) {
    return 0;
  }

  try {
    const depth = stream.getColorDepth?.();
    if (typeof depth === "number") {
      return getColorLevelFromDepth(depth);
    }
  } catch {}

  try {
    if (stream.hasColors?.(16_777_216)) {
      return 3;
    }

    if (stream.hasColors?.(256)) {
      return 2;
    }

    if (stream.hasColors?.(16) || stream.hasColors?.()) {
      return 1;
    }
  } catch {}

  return 1;
}

function parseForceColor(value: string | undefined): ColorSupportLevel | undefined {
  if (value === undefined) {
    return undefined;
  }

  switch (value) {
    case "false":
    case "0":
      return 0;
    case "2":
      return 2;
    case "3":
      return 3;
    default:
      return 1;
  }
}

function parseColorFlag(argv: readonly string[]): ColorFlagName | undefined {
  for (const token of argv) {
    if (token === "--no-color") {
      return "never";
    }

    if (token === "--color") {
      return "always";
    }

    if (token.startsWith(COLOR_FLAG_PREFIX)) {
      const value = token.slice(COLOR_FLAG_PREFIX.length).toLowerCase();
      if (
        value === "always" ||
        value === "auto" ||
        value === "false" ||
        value === "never" ||
        value === "truecolor" ||
        value === "256"
      ) {
        return value;
      }
    }
  }

  return undefined;
}

function colorLevelFromFlag(flag: ColorFlagName | undefined): ColorSupportLevel | undefined {
  switch (flag) {
    case "always":
      return 1;
    case "256":
      return 2;
    case "truecolor":
      return 3;
    case "false":
    case "never":
      return 0;
    default:
      return undefined;
  }
}

function isBrowserMain(resolved: ResolvedDetectOptions): boolean {
  return typeof resolved.browserWindow !== "undefined" && typeof resolved.browserDocument !== "undefined";
}

function isWorkerLike(resolved: ResolvedDetectOptions): boolean {
  return typeof resolved.workerGlobalScope !== "undefined" && typeof resolved.browserWindow === "undefined";
}

/** Detect the current runtime conservatively using feature detection. */
export function detectRuntime(options?: DetectOptions): RuntimeKind {
  const resolved = resolveOptions(options);

  if (isBrowserMain(resolved)) {
    return "browser";
  }

  if (isWorkerLike(resolved)) {
    return "worker";
  }

  if (resolved.process?.versions?.bun) {
    return "bun";
  }

  if (resolved.deno?.version?.deno) {
    return "deno";
  }

  if (resolved.process?.versions?.node) {
    return "node";
  }

  return "unknown";
}

/** Detect the execution context conservatively. */
export function detectExecutionContext(options?: DetectOptions): ExecutionContextKind {
  const resolved = resolveOptions(options);

  if (isBrowserMain(resolved)) {
    return "browser-main";
  }

  if (isWorkerLike(resolved)) {
    return "web-worker";
  }

  if (resolved.process || resolved.deno) {
    return "server";
  }

  return "unknown";
}

/** Detect the host platform, returning unknown when it cannot be known safely. */
export function detectPlatform(options?: DetectOptions): PlatformKind {
  const resolved = resolveOptions(options);
  if (detectExecutionContext(resolved) !== "server") {
    return "browser";
  }

  const processPlatform = normalizePlatform(resolved.process?.platform);
  if (processPlatform !== "unknown") {
    return processPlatform;
  }

  const denoPlatform = normalizePlatform(resolved.deno?.build?.os);
  if (denoPlatform !== "unknown") {
    return denoPlatform;
  }

  return normalizePlatform(
    resolved.navigator?.userAgentData?.platform ?? resolved.navigator?.platform,
  );
}

/** Whether a process-like object is available. */
export function hasProcess(options?: DetectOptions): boolean {
  return Boolean(resolveOptions(options).process);
}

/** Whether stdout or stderr behaves like a TTY. */
export function isTTY(stream: StreamName = "stdout", options?: DetectOptions): boolean {
  const resolved = resolveOptions(options);
  const target = stream === "stderr" ? resolved.stderr : resolved.stdout;
  return Boolean(target?.isTTY);
}

/** Conservative CI-ish detection for automation-sensitive decisions. */
export function isCI(options?: DetectOptions): boolean {
  const env = resolveOptions(options).env;
  return [
    env.CI,
    env.CONTINUOUS_INTEGRATION,
    env.BUILD_NUMBER,
    env.RUN_ID,
    env.GITHUB_ACTIONS,
    env.GITLAB_CI,
    env.BUILDKITE,
    env.CIRCLECI,
    env.TRAVIS,
  ].some((value) => isTruthyEnv(value));
}

/** Normalized environment hints useful for CLI/color decisions. */
export function getEnvHints(options?: DetectOptions): EnvHints {
  const resolved = resolveOptions(options);

  return {
    ci: isCI(resolved),
    colorFlag: parseColorFlag(resolved.argv),
    forceColor: resolved.env.FORCE_COLOR,
    hasProcess: Boolean(resolved.process),
    noColor: typeof resolved.env.NO_COLOR !== "undefined",
    nodeDisableColors: isTruthyEnv(resolved.env.NODE_DISABLE_COLORS),
  };
}

function detectColorSupportFromResolved(
  stream: StreamName,
  resolved: ResolvedDetectOptions,
): ColorSupportLevel {
  const target = stream === "stderr" ? resolved.stderr : resolved.stdout;

  if (typeof resolved.explicitColor === "number") {
    return resolved.explicitColor;
  }

  if (typeof resolved.explicitColor === "boolean") {
    return resolved.explicitColor ? Math.max(getNativeStreamColorLevel(target) ?? 1, 1) as ColorSupportLevel : 0;
  }

  const colorFlag = colorLevelFromFlag(parseColorFlag(resolved.argv));
  if (colorFlag !== undefined) {
    return colorFlag;
  }

  const forceColor = parseForceColor(resolved.env.FORCE_COLOR);
  if (forceColor !== undefined) {
    return forceColor;
  }

  if (typeof resolved.env.NO_COLOR !== "undefined" || isTruthyEnv(resolved.env.NODE_DISABLE_COLORS)) {
    return 0;
  }

  const nativeLevel = getNativeStreamColorLevel(target);
  if (nativeLevel !== undefined) {
    return nativeLevel;
  }

  if (isCI(resolved)) {
    return 1;
  }

  return 0;
}

/** Detect color support for stdout or stderr using explicit overrides, flags, env, native capabilities, then conservative fallback. */
export function detectColorSupport(stream: StreamName = "stdout", options?: DetectOptions): ColorSupportLevel {
  return detectColorSupportFromResolved(stream, resolveOptions(options));
}

/** Detect terminal support for stdout and stderr separately. */
export function detectTerminalSupport(options?: DetectOptions): TerminalSupportSnapshot {
  const resolved = resolveOptions(options);

  return {
    stderr: {
      isTTY: isTTY("stderr", resolved),
      level: detectColorSupportFromResolved("stderr", resolved),
    },
    stdout: {
      isTTY: isTTY("stdout", resolved),
      level: detectColorSupportFromResolved("stdout", resolved),
    },
  };
}

/** Return a normalized environment snapshot. Default calls are memoized and side-effect free. */
export function getMyEnv(options?: DetectOptions): MyEnvSnapshot {
  if (!options && memoizedSnapshot) {
    return memoizedSnapshot;
  }

  const resolved = resolveOptions(options);
  const snapshot: MyEnvSnapshot = {
    executionContext: detectExecutionContext(resolved),
    hasProcess: Boolean(resolved.process),
    hints: getEnvHints(resolved),
    platform: detectPlatform(resolved),
    runtime: detectRuntime(resolved),
    terminal: detectTerminalSupport(resolved),
  };

  if (!options) {
    memoizedSnapshot = snapshot;
  }

  return snapshot;
}

/** Clear the default snapshot cache, mainly for tests and controlled benchmarks. */
export function clearMyEnvCache(): void {
  memoizedSnapshot = undefined;
}
