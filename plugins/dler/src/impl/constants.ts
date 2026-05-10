export const DLER_PLUGIN_NAME = "dler";

export const DLER_COMMAND_NAMES = {
  build: "dler build",
  pub: "dler pub",
  tsc: "dler tsc",
} as const;

export const DLER_CONCURRENCY_DEFAULTS = {
  build: 4,
  pub: 1,
  tsc: 5,
} as const;

export const DLER_BUILD_DEFAULTS = {
  bundleStrategy: "auto",
  declarationStrategy: "emit",
  provider: "bun",
} as const;

export const DLER_BUILD_BUNDLE_STRATEGIES = ["auto", "single", "split"] as const;

export const DLER_BUILD_DECLARATION_STRATEGIES = [
  "emit",
  "fast",
  "off",
  "rollup",
] as const;

export const DLER_PUBLISH_DEFAULTS = {
  publishFrom: "dist",
} as const;

export const DLER_TSC_DEFAULTS = {
  fallbackRunner: "tsc",
  primaryRunner: "tsgo",
  runnerMode: "auto",
  tsconfigFileName: "tsconfig.json",
} as const;

export const DLER_TSC_RUNNER_MODES = ["auto", "tsgo", "tsc"] as const;

export const DLER_TSC_NO_EMIT_ARGS = ["--noEmit"] as const;

export const DLER_TSC_BUNX_ARGS = ["--silent"] as const;
