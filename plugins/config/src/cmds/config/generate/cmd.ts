import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { defineCommand } from "@reliverse/rempts";

import {
  createRseConfigDefaults,
  createRseConfigSchema,
  deepMergeMissing,
  parseConfigObject,
  RSE_CONFIG_FILE,
  RSE_CONFIG_FILES,
  RSE_SCHEMA_FILE,
  stringifyJson,
} from "../../../impl/schema";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveDefaultConfigPath(
  cwd: string,
  rawConfigPath: string | undefined,
): Promise<string> {
  const explicit = rawConfigPath?.trim();
  if (explicit) return resolve(cwd, explicit);

  const existingPaths = [];
  for (const file of RSE_CONFIG_FILES) {
    const path = resolve(cwd, file);
    if (await pathExists(path)) existingPaths.push(path);
  }

  if (existingPaths.length > 1) {
    throw new Error(`Found both ${RSE_CONFIG_FILES.join(" and ")}. Keep only one Rse config file.`);
  }

  return existingPaths[0] ?? resolve(cwd, RSE_CONFIG_FILE);
}

async function readExistingConfig(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    if (raw.trim().length === 0) return undefined;
    return parseConfigObject(raw, path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyJson(value), "utf8");
}

export default defineCommand({
  meta: {
    name: "generate",
    description:
      "Generate optional rse.config.json/rse.config.jsonc and rse.schema.json files from loaded Rse plugins.",
  },
  interactive: "never",
  conventions: {
    idempotent: true,
    supportsApply: true,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.write"],
  },
  help: {
    examples: [
      "rse config generate",
      "rse config generate --apply",
      "rse config generate --config rse.config.json --schema rse.schema.json --apply",
      "rse config generate --config rse.config.jsonc --apply",
    ],
    text: "The Rse config file is fully optional. This command creates editor-friendly config/schema files from loaded plugin schema contributions. Existing config values are preserved; missing defaults are added. Config may be rse.config.json or rse.config.jsonc; schema output is rse.schema.json intentionally.",
  },
  options: {
    config: {
      type: "string",
      description:
        "Config file path to create or update; supports .json and .jsonc. Defaults to existing rse.config.json/jsonc, then rse.config.json.",
      inputSources: ["flag"],
    },
    schema: {
      type: "string",
      defaultValue: RSE_SCHEMA_FILE,
      description: "Schema file path to generate",
      inputSources: ["flag", "default"],
    },
  },
  async handler(ctx) {
    const loadedPlugins = ctx.cli?.pluginDiscovery?.loaded ?? [];
    const schema = createRseConfigSchema(loadedPlugins);
    const defaults = createRseConfigDefaults(loadedPlugins);
    const configPath = await resolveDefaultConfigPath(ctx.cwd, ctx.options.config);
    const schemaPath = resolve(ctx.cwd, ctx.options.schema?.trim() || RSE_SCHEMA_FILE);
    const existingConfig = await readExistingConfig(configPath);
    const nextConfig = existingConfig ? deepMergeMissing(existingConfig, defaults) : defaults;
    const pluginContributors = loadedPlugins
      .filter((plugin) => plugin.config?.schema || plugin.config?.defaults)
      .map((plugin) => plugin.packageName);

    const result = {
      apply: ctx.safety.apply,
      configPath,
      schemaPath,
      plugins: pluginContributors,
      wroteConfig: false,
      wroteSchema: false,
    };

    if (!ctx.safety.apply) {
      if (ctx.output.mode === "json") {
        ctx.output.result(result, "config generate");
      } else {
        ctx.out("rse config generate preview");
        ctx.out(`  Config: ${configPath}`);
        ctx.out(`  Schema: ${schemaPath}`);
        ctx.out(`  Plugin schema contributors: ${pluginContributors.join(", ") || "none"}`);
        ctx.out("No files written. Pass --apply to write the config file and rse.schema.json.");
      }
      return;
    }

    ctx.safety.assertApplied("fs.write");
    await writeJsonFile(schemaPath, schema);
    await writeJsonFile(configPath, nextConfig);

    const appliedResult = {
      ...result,
      wroteConfig: true,
      wroteSchema: true,
    };
    if (ctx.output.mode === "json") {
      ctx.output.result(appliedResult, "config generate");
      return;
    }

    ctx.out("Generated Rse config files.");
    ctx.out(`  Config: ${configPath}`);
    ctx.out(`  Schema: ${schemaPath}`);
    ctx.out(`  Plugin schema contributors: ${pluginContributors.join(", ") || "none"}`);
  },
});
