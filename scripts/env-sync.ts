#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type Profile = "dev" | "prod";
type KeyValue = Record<string, string>;

type EnvTarget = {
  path: string;
  examplePath?: string;
  updates: KeyValue;
};

const repoRoot = resolve(import.meta.dir, "..");
const repoSlug = "reliverse";
const domain = "reliverse.org";
const publicUrl = `https://${domain}`;
const localUrl = "http://localhost:3000";
const pgHost = "127.0.0.1";
const pgPort = 5432;
const placeholderPasswords = new Set(["", "change_me", "password", "postgres"]);

function parseArgs(argv: string[]) {
  let profile: Profile | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--profile") {
      const value = argv[i + 1];
      if (value !== "dev" && value !== "prod") throw new Error(`invalid --profile: ${value}`);
      profile = value;
      i += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return { profile: profile ?? detectProfile(), dryRun };
}

function printHelp() {
  console.log(`Usage: bun scripts/env-sync.ts [--profile dev|prod] [--dry-run]

Syncs Reliverse env surfaces to the canonical DB/profile contract.
- dev  -> reliverse_dev on 127.0.0.1:5432
- prod -> reliverse_prod on 127.0.0.1:5432
`);
}

function detectProfile(): Profile {
  return repoRoot.startsWith("/home/deploy/prod/") ? "prod" : "dev";
}

function ensureFile(path: string, examplePath: string | undefined, dryRun: boolean) {
  if (existsSync(path) || dryRun) return;
  mkdirSync(dirname(path), { recursive: true });
  if (examplePath && existsSync(examplePath)) {
    copyFileSync(examplePath, path);
    return;
  }
  writeFileSync(path, "", "utf8");
}

function parseEnv(text: string): KeyValue {
  const out: KeyValue = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !rawLine.includes("=")) continue;
    const [rawKey, ...rest] = rawLine.split("=");
    let value = rest.join("=").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[rawKey.trim()] = value;
  }
  return out;
}

function stringifyValue(value: string) {
  return JSON.stringify(value);
}

function upsertEnv(path: string, updates: KeyValue, dryRun: boolean) {
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = text.split(/\r?\n/);
  const seen = new Set<string>();
  const next: string[] = [];

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#") || !line.includes("=")) {
      next.push(line);
      continue;
    }
    const key = line.split("=", 1)[0]?.trim() ?? "";
    if (key in updates) {
      next.push(`${key}=${stringifyValue(updates[key]!)}`);
      seen.add(key);
    } else {
      next.push(line);
    }
  }

  if (next.length && next[next.length - 1] !== "") next.push("");
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${stringifyValue(value)}`);
  }

  const rendered = `${next.join("\n").replace(/\n+$/u, "")}\n`;
  if (!dryRun) writeFileSync(path, rendered, "utf8");
}

function parsePostgresUrl(input?: string | null) {
  if (!input) return null;
  try {
    const url = new URL(input);
    if (!(url.protocol === "postgres:" || url.protocol === "postgresql:")) return null;
    return {
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      host: url.hostname || pgHost,
      port: Number(url.port || String(pgPort)),
      database: url.pathname.replace(/^\//u, ""),
    };
  } catch {
    return null;
  }
}

function canonicalPassword(profile: Profile, existingCandidates: (string | undefined)[]) {
  const expectedRole = `${repoSlug}_${profile}`;
  const expectedDb = `${repoSlug}_${profile}`;
  for (const candidate of existingCandidates) {
    const parsed = parsePostgresUrl(candidate);
    if (!parsed) continue;
    if (parsed.username === expectedRole && parsed.database === expectedDb && !placeholderPasswords.has(parsed.password)) {
      return parsed.password;
    }
  }
  return "change_me";
}

function makeDsn(profile: Profile, password: string) {
  const role = `${repoSlug}_${profile}`;
  const database = `${repoSlug}_${profile}`;
  return `postgresql://${role}:${encodeURIComponent(password)}@${pgHost}:${pgPort}/${database}`;
}

function collectExisting(paths: string[]) {
  const values: string[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const env = parseEnv(readFileSync(path, "utf8"));
    if (env.DATABASE_URL) values.push(env.DATABASE_URL);
    if (env.SERVER_DATABASE_URL) values.push(env.SERVER_DATABASE_URL);
  }
  return values;
}

function buildTargets(profile: Profile): EnvTarget[] {
  const password = canonicalPassword(profile, collectExisting([
    join(repoRoot, ".env"),
    join(repoRoot, "apps/api/.env"),
    join(repoRoot, "packages/db/.env"),
    "/home/deploy/.config/reliverse/reliverse-web.env",
    "/home/deploy/.config/reliverse/reliverse-api.env",
  ]));
  const dsn = makeDsn(profile, password);
  const baseUrl = profile === "prod" ? publicUrl : localUrl;
  const polarSuccessUrl = `${baseUrl}/app`;

  if (profile === "dev") {
    return [
      {
        path: join(repoRoot, ".env"),
        examplePath: join(repoRoot, ".env.example"),
        updates: {
          DATABASE_URL: dsn,
          VITE_BASE_URL: baseUrl,
          POLAR_SUCCESS_URL: polarSuccessUrl,
        },
      },
      {
        path: join(repoRoot, "apps/api/.env"),
        examplePath: join(repoRoot, "apps/api/.env.example"),
        updates: { DATABASE_URL: dsn },
      },
      {
        path: join(repoRoot, "packages/db/.env"),
        examplePath: join(repoRoot, "packages/db/.env.example"),
        updates: { SERVER_DATABASE_URL: dsn },
      },
    ];
  }

  return [
    ...(repoRoot.startsWith("/home/deploy/prod/") ? [
      {
        path: join(repoRoot, "apps/api/.env"),
        examplePath: join(repoRoot, "apps/api/.env.example"),
        updates: {
          DATABASE_URL: dsn,
          SERVER_DATABASE_URL: dsn,
          BETTER_AUTH_URL: baseUrl,
          CORS_ORIGIN: baseUrl,
        },
      },
      {
        path: join(repoRoot, "packages/db/.env"),
        examplePath: join(repoRoot, "packages/db/.env.example"),
        updates: { SERVER_DATABASE_URL: dsn },
      },
    ] : []),
    {
      path: "/home/deploy/.config/reliverse/reliverse-web.env",
      updates: {
        DATABASE_URL: dsn,
        SERVER_DATABASE_URL: dsn,
        VITE_BASE_URL: baseUrl,
        BETTER_AUTH_URL: baseUrl,
        CORS_ORIGIN: baseUrl,
        POLAR_SUCCESS_URL: polarSuccessUrl,
      },
    },
    {
      path: "/home/deploy/.config/reliverse/reliverse-api.env",
      updates: {
        DATABASE_URL: dsn,
        SERVER_DATABASE_URL: dsn,
        BETTER_AUTH_URL: baseUrl,
        CORS_ORIGIN: baseUrl,
      },
    },
  ];
}

function main() {
  const { profile, dryRun } = parseArgs(process.argv.slice(2));
  const targets = buildTargets(profile);
  console.log(`[INFO] repo=${repoSlug} profile=${profile} repoRoot=${repoRoot} dryRun=${dryRun}`);
  for (const target of targets) {
    ensureFile(target.path, target.examplePath, dryRun);
    upsertEnv(target.path, target.updates, dryRun);
    console.log(`[PASS] synced ${target.path}`);
  }
}

main();
