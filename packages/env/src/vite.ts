import { type } from "arkenv/arktype";
import { ArkErrors } from "arktype";

// https://arkenv.js.org
export const Env = type({
  // POLAR_ACCESS_TOKEN: "string > 0",
  // POLAR_SUCCESS_URL: "string.url",
  // CORS_ORIGIN: "string.url",

  "DATABASE_URL?": "string.url",
  // BETTER_AUTH_SECRET: "string >= 32",
  // BETTER_AUTH_URL: "string.url",

  // Optional OAuth2 providers
  "GITHUB_CLIENT_ID?": "string",
  "GITHUB_CLIENT_SECRET?": "string",
  "GOOGLE_CLIENT_ID?": "string",
  "GOOGLE_CLIENT_SECRET?": "string",

  // PORT: "0 <= number.integer <= 65535",
  "VITE_API_URL?": "string.ip | 'localhost'",
  "VITE_BASE_URL?": "string.url | 'localhost'",
  // NODE_ENV: "'development' | 'production' | 'test' = 'development'",
  // DEBUGGING: "boolean = false",

  // // Required variables with validation
  // DATABASE_HOST: "string.host",
  // DATABASE_PORT: "number.port",

  // // Boolean values (accepts "true"/"false" strings, converts to boolean)
  // DEBUG: "boolean",

  // Optional variables with defaults
  LOG_LEVEL: "'debug' | 'info' | 'warn' | 'error' = 'info'",

  // // Arrays (comma-separated by default)
  // ALLOWED_ORIGINS: type("string[]").default(() => ["localhost"]),
  // FEATURE_FLAGS: type("string[]").default(() => []),

  // Optional environment variable
  "API_KEY?": "string",

  // // Feature flags
  // ENABLE_BETA_FEATURES: "boolean = false",
  // MAINTENANCE_MODE: "boolean = false",
});

type EnvValues = typeof Env.infer;

const read = (): Record<string, string | undefined> => {
  if (typeof import.meta !== "undefined" && import.meta.env) {
    return import.meta.env as Record<string, string | undefined>;
  }

  if (typeof process !== "undefined" && process.env) {
    return process.env;
  }

  return {};
};

const raw = read();

const values: EnvValues = {
  LOG_LEVEL: (raw.LOG_LEVEL ?? "info") as EnvValues["LOG_LEVEL"],
  ...(raw.DATABASE_URL !== undefined ? { DATABASE_URL: raw.DATABASE_URL } : {}),
  ...(raw.GITHUB_CLIENT_ID !== undefined ? { GITHUB_CLIENT_ID: raw.GITHUB_CLIENT_ID } : {}),
  ...(raw.GITHUB_CLIENT_SECRET !== undefined
    ? { GITHUB_CLIENT_SECRET: raw.GITHUB_CLIENT_SECRET }
    : {}),
  ...(raw.GOOGLE_CLIENT_ID !== undefined ? { GOOGLE_CLIENT_ID: raw.GOOGLE_CLIENT_ID } : {}),
  ...(raw.GOOGLE_CLIENT_SECRET !== undefined
    ? { GOOGLE_CLIENT_SECRET: raw.GOOGLE_CLIENT_SECRET }
    : {}),
  ...(raw.VITE_API_URL !== undefined ? { VITE_API_URL: raw.VITE_API_URL } : {}),
  ...(raw.VITE_BASE_URL !== undefined ? { VITE_BASE_URL: raw.VITE_BASE_URL } : {}),
  ...(raw.API_KEY !== undefined ? { API_KEY: raw.API_KEY } : {}),
};

const parsed = Env(values);

if (parsed instanceof ArkErrors) {
  throw new Error(`Invalid environment variables: ${parsed.summary}`);
}

export const env = parsed;
