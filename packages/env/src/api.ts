import arkenv from "arkenv";
import { type } from "arkenv/arktype";

// https://arkenv.js.org
export const Env = type({
  "POLAR_ACCESS_TOKEN?": "string",
  "POLAR_SUCCESS_URL?": "string.url",
  POLAR_MODE: "'sandbox' | 'production' = 'sandbox'",
  "CORS_ORIGIN?": "string.url",

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

  "RESEND_TOKEN?": "string > 0",
});

export const env = arkenv(Env);
