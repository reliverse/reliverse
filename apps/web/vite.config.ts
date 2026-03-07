import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// (scroll down to see vite config)
// TODO: implement env validation
// ======================================================================
// https://arkenv.js.org
// import arkenvVitePlugin from "@arkenv/vite-plugin";
// import arkenv from "arkenv";
// import { type } from "arkenv/arktype";
// import { loadEnv } from "vite";
/* export const Env = type({
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
export default defineConfig(async ({ mode }) => {
const env = arkenv(Env, { env: loadEnv(mode, process.cwd(), "") });
console.log(`${env.API_KEY} ${typeof env.API_KEY}`);
return {
plugins: [
arkenvVitePlugin(Env) */
// ======================================================================

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    tsconfigPaths: true,
  },
  server: {
    port: 3000,
  },
  plugins: [
    devtools(),
    // https://tanstack.com/start/latest/docs/framework/react/guide/hosting
    tanstackStart(),
    nitro(),
    viteReact({
      // https://react.dev/learn/react-compiler
      babel: {
        plugins: [
          [
            "babel-plugin-react-compiler",
            {
              target: "19",
            },
          ],
        ],
      },
    }),
    tailwindcss(),
  ],
});
