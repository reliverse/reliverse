import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type AppRegistryEntry = {
  id: string;
  repoDir: string;
  workspacePath: string;
  service: string;
  smokeUrl: string;
  pm?: "bun" | "pnpm" | "npm";
  installScope?: "auto" | "root" | "app" | "both";
  filter?: string;
};

export type AppRegistry = {
  apps: AppRegistryEntry[];
};

export function resolveRegistryPath(input?: string): string {
  if (input && input.trim()) return input;
  return path.join(os.homedir(), ".config", "reliverse", "apps.json");
}

export async function readRegistry(registryPath?: string): Promise<AppRegistry> {
  const finalPath = resolveRegistryPath(registryPath);
  const raw = await readFile(finalPath, "utf8");
  const parsed = JSON.parse(raw) as AppRegistry;
  if (!parsed || !Array.isArray(parsed.apps)) {
    throw new Error(`Invalid registry format in ${finalPath}`);
  }
  return parsed;
}

export async function writeRegistry(data: AppRegistry, registryPath?: string): Promise<void> {
  const finalPath = resolveRegistryPath(registryPath);
  const body = JSON.stringify(data, null, 2) + "\n";
  await writeFile(finalPath, body, "utf8");
}

export function listApps(registry: AppRegistry): AppRegistryEntry[] {
  return [...registry.apps].sort((a, b) => a.id.localeCompare(b.id));
}

export function getApp(registry: AppRegistry, appId: string): AppRegistryEntry | undefined {
  return registry.apps.find((a) => a.id === appId);
}

export function upsertApp(registry: AppRegistry, app: AppRegistryEntry): AppRegistry {
  const idx = registry.apps.findIndex((a) => a.id === app.id);
  if (idx === -1) return { apps: [...registry.apps, app] };
  const apps = [...registry.apps];
  apps[idx] = { ...apps[idx], ...app };
  return { apps };
}

export function removeApp(registry: AppRegistry, appId: string): AppRegistry {
  return { apps: registry.apps.filter((a) => a.id !== appId) };
}

export type ReliverseApiClientOptions = {
  baseUrl?: string;
  token?: string;
};

export type ReliverseApiClient = {
  getHealth(): Promise<unknown>;
  get(pathname: string): Promise<unknown>;
  post(pathname: string, body?: unknown): Promise<unknown>;
};

export function createReliverseApiClient(options: ReliverseApiClientOptions = {}): ReliverseApiClient {
  const baseUrl = (options.baseUrl ?? "https://api.reliverse.org").replace(/\/$/, "");

  async function request(
    method: "GET" | "POST",
    pathname: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.token) headers.authorization = `Bearer ${options.token}`;

    const res = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${method} ${url} failed: ${res.status} ${res.statusText} :: ${text}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) return await res.json();
    return await res.text();
  }

  return {
    getHealth() {
      return request("GET", "/health");
    },
    get(pathname: string) {
      return request("GET", pathname);
    },
    post(pathname: string, body?: unknown) {
      return request("POST", pathname, body);
    },
  };
}
