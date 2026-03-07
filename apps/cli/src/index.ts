#!/usr/bin/env bun
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createReliverseApiClient,
  getApp,
  listApps,
  readRegistry,
  removeApp,
  resolveRegistryPath,
  upsertApp,
  writeRegistry,
  type AppRegistryEntry,
} from "@reliverse/sdk";

type Flags = Record<string, string | boolean>;
type AppKind = "web" | "api";

function parseFlags(args: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }

    const key = a.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    i++;
  }

  return { positional, flags };
}

function asString(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asBool(v: string | boolean | undefined): boolean {
  return v === true || v === "true";
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function help() {
  console.log(`reliverse cli

Usage:
  reliverse registry list [registryPath]
  reliverse registry get <appId> [registryPath]
  reliverse registry rm <appId> [registryPath]
  reliverse registry upsert <json> [registryPath]

  reliverse app list [registryPath]
  reliverse app add <id> <repoDir> <workspacePath> <service> <smokeUrl> [registryPath]
  reliverse app init <id> <kind:web|api> <name> <repoDir> <service> <smokeUrl> [registryPath] [--template <github-url-or-shorthand>] [--template-branch <branch|sha>] [--template-recursive]
  reliverse app deploy <appId>
  reliverse app status <appId> [registryPath]

  reliverse api health [--base-url <url>] [--token <token>]

Examples:
  reliverse app list
  reliverse app init demo-web web demo /home/blefnk/deploy/reliverse/reliverse bun-web-3090-demo.service https://demo.reliverse.org
  reliverse app init demo-api api demo /home/blefnk/deploy/reliverse/reliverse bun-api-3091-demo.service https://api.demo.reliverse.org --template owner/repo/tree/main/apps/api/template
  reliverse app status reliverse-web
  reliverse app deploy reliverse-web
  reliverse api health --base-url https://api.reliverse.org
`);
}

async function deployApp(appId: string) {
  const deployBin = `${process.env.HOME ?? ""}/.local/bin/bleverse-deploy-app`;
  const proc = Bun.spawn([deployBin, appId], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`deploy failed for app ${appId} (exit=${code})`);
}

async function runGitpick(
  template: string,
  targetDir: string,
  branch?: string,
  recursive?: boolean,
) {
  const args = ["x", "gitpick", template, targetDir];
  if (branch) args.push("-b", branch);
  if (recursive) args.push("-r");

  const proc = Bun.spawn(["bun", ...args], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`gitpick failed (exit=${code}). Template: ${template}`);
  }
}

async function appStatus(appId: string, registryPath?: string) {
  const registry = await readRegistry(registryPath);
  const app = getApp(registry, appId);
  if (!app) throw new Error(`app not found: ${appId}`);

  const uid = `${process.getuid?.() ?? 1000}`;
  const env = {
    ...process.env,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? `/run/user/${uid}`,
    DBUS_SESSION_BUS_ADDRESS:
      process.env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=/run/user/${uid}/bus`,
  };

  const statusProc = Bun.spawn(["systemctl", "--user", "is-active", app.service], { env });
  const statusCode = await statusProc.exited;
  const serviceActive = statusCode === 0;

  let healthOk = false;
  let healthBody: unknown = null;
  let healthError = "";
  try {
    const url = `${app.smokeUrl.replace(/\/$/, "")}/health`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    healthOk = true;
    const ct = res.headers.get("content-type") ?? "";
    healthBody = ct.includes("application/json") ? await res.json() : await res.text();
  } catch (err) {
    healthError = err instanceof Error ? err.message : String(err);
  }

  console.log(
    JSON.stringify(
      {
        id: app.id,
        service: app.service,
        serviceActive,
        smokeUrl: app.smokeUrl,
        healthOk,
        health: healthBody,
        healthError: healthError || undefined,
      },
      null,
      2,
    ),
  );
}

async function appInit(
  id: string,
  kind: AppKind,
  name: string,
  repoDir: string,
  service: string,
  smokeUrl: string,
  registryPath?: string,
  options?: {
    template?: string;
    templateBranch?: string;
    templateRecursive?: boolean;
  },
) {
  const workspacePath = `apps/${kind}/${name}`;
  const appDir = path.join(repoDir, workspacePath);

  if (!(await exists(path.join(repoDir, ".git")))) {
    throw new Error(`repoDir is not a git repo: ${repoDir}`);
  }
  if (await exists(appDir)) {
    throw new Error(`workspace already exists: ${appDir}`);
  }

  if (options?.template) {
    await runGitpick(options.template, appDir, options.templateBranch, options.templateRecursive);
  } else {
    await mkdir(path.join(appDir, "src"), { recursive: true });

    const pkg = {
      name: `@reliverse/${name}-${kind}`,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts:
        kind === "web"
          ? {
              dev: "PORT=${PORT:-3000} bun --watch src/index.ts",
              build: "bun build src/index.ts --outdir ./dist --target bun",
              start: "PORT=${PORT:-3000} bun src/index.ts",
              smoke: "bash ./smoke.sh ${SMOKE_URL:-http://localhost:3000}",
            }
          : {
              dev: "PORT=${PORT:-3001} bun --watch src/index.ts",
              start: "PORT=${PORT:-3001} bun src/index.ts",
            },
    };

    const src =
      kind === "web"
        ? `import { serve } from "bun";\n\nconst port = Number(process.env.PORT ?? 3000);\nconst service = "${id}";\n\nserve({\n  port,\n  fetch(req) {\n    const url = new URL(req.url);\n    if (url.pathname === "/health") return Response.json({ ok: true, service, port });\n    if (url.pathname === "/") return new Response("<h1>${name}</h1>", { headers: { "content-type": "text/html" } });\n    return Response.json({ ok: true, service, path: url.pathname, port });\n  },\n});\n\nconsole.log("listening", service, port);\n`
        : `import { serve } from "bun";\n\nconst port = Number(process.env.PORT ?? 3001);\nconst service = "${id}";\n\nserve({\n  port,\n  fetch(req) {\n    const url = new URL(req.url);\n    if (url.pathname === "/health") return Response.json({ ok: true, service, port });\n    return Response.json({ ok: true, service, path: url.pathname, port });\n  },\n});\n\nconsole.log("listening", service, port);\n`;

    await writeFile(path.join(appDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n", "utf8");
    await writeFile(path.join(appDir, "src", "index.ts"), src, "utf8");

    if (kind === "web") {
      const smoke = `#!/usr/bin/env bash\nset -euo pipefail\nBASE_URL="${"${1:-http://localhost:3000}"}"\ncurl -fsS "$BASE_URL/health" >/dev/null\necho "smoke: ok ($BASE_URL/health)"\n`;
      await writeFile(path.join(appDir, "smoke.sh"), smoke, { encoding: "utf8", mode: 0o755 });
    }
  }

  const registry = await readRegistry(registryPath);
  const next = upsertApp(registry, {
    id,
    repoDir,
    workspacePath,
    service,
    smokeUrl,
  });
  await writeRegistry(next, registryPath);

  console.log(
    JSON.stringify(
      {
        created: appDir,
        registry: resolveRegistryPath(registryPath),
        template: options?.template || null,
        app: { id, repoDir, workspacePath, service, smokeUrl },
      },
      null,
      2,
    ),
  );
}

async function main() {
  const [, , ...rawArgs] = process.argv;
  const { positional: args, flags } = parseFlags(rawArgs);

  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    help();
    return;
  }

  const [scope, action, a1, a2, a3, a4, a5, a6, a7] = args;

  if (scope === "registry") {
    if (action === "list") {
      const registry = await readRegistry(a1);
      console.log(JSON.stringify(listApps(registry), null, 2));
      return;
    }

    if (action === "get") {
      if (!a1) throw new Error("appId is required");
      const registry = await readRegistry(a2);
      const app = getApp(registry, a1);
      if (!app) throw new Error(`app not found: ${a1}`);
      console.log(JSON.stringify(app, null, 2));
      return;
    }

    if (action === "rm") {
      if (!a1) throw new Error("appId is required");
      const registryPath = a2;
      const registry = await readRegistry(registryPath);
      const next = removeApp(registry, a1);
      await writeRegistry(next, registryPath);
      console.log(`removed: ${a1}`);
      return;
    }

    if (action === "upsert") {
      if (!a1) throw new Error("json payload is required");
      const payload = JSON.parse(a1) as AppRegistryEntry;
      const registryPath = a2;
      const registry = await readRegistry(registryPath);
      const next = upsertApp(registry, payload);
      await writeRegistry(next, registryPath);
      console.log(`upserted: ${payload.id}`);
      return;
    }
  }

  if (scope === "app") {
    if (action === "list") {
      const registry = await readRegistry(a1);
      console.log(JSON.stringify(listApps(registry), null, 2));
      return;
    }

    if (action === "add") {
      if (!a1 || !a2 || !a3 || !a4 || !a5) {
        throw new Error(
          "usage: reliverse app add <id> <repoDir> <workspacePath> <service> <smokeUrl> [registryPath]",
        );
      }
      const app: AppRegistryEntry = {
        id: a1,
        repoDir: a2,
        workspacePath: a3,
        service: a4,
        smokeUrl: a5,
      };
      const registryPath = a6;
      const registry = await readRegistry(registryPath);
      const next = upsertApp(registry, app);
      await writeRegistry(next, registryPath);
      console.log(`app added/updated: ${a1} (${resolveRegistryPath(registryPath)})`);
      return;
    }

    if (action === "init") {
      if (!a1 || !a2 || !a3 || !a4 || !a5 || !a6) {
        throw new Error(
          "usage: reliverse app init <id> <kind:web|api> <name> <repoDir> <service> <smokeUrl> [registryPath] [--template ...]",
        );
      }
      if (a2 !== "web" && a2 !== "api") throw new Error("kind must be web|api");
      await appInit(a1, a2, a3, a4, a5, a6, a7, {
        template: asString(flags["template"]),
        templateBranch: asString(flags["template-branch"]),
        templateRecursive: asBool(flags["template-recursive"]),
      });
      return;
    }

    if (action === "deploy") {
      if (!a1) throw new Error("usage: reliverse app deploy <appId>");
      await deployApp(a1);
      return;
    }

    if (action === "status") {
      if (!a1) throw new Error("usage: reliverse app status <appId> [registryPath]");
      await appStatus(a1, a2);
      return;
    }
  }

  if (scope === "api" && action === "health") {
    const baseUrl = asString(flags["base-url"]);
    const token = asString(flags["token"]);
    const api = createReliverseApiClient({ baseUrl, token });
    const health = await api.getHealth();
    console.log(JSON.stringify(health, null, 2));
    return;
  }

  help();
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
