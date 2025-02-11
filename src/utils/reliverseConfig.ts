import type { TSchema } from "@sinclair/typebox";
import type { PackageJson } from "pkg-types";

import { relinka } from "@reliverse/prompts";
import { getUserPkgManager, isBunPM, runtimeInfo } from "@reliverse/runtime";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { parseJSONC } from "confbox";
import destr, { safeDestr } from "destr";
import fs from "fs-extra";
import path from "pathe";
import { readPackageJSON } from "pkg-types";

import type { DeploymentService } from "~/types.js";

import {
  DEFAULT_DOMAIN,
  UNKNOWN_VALUE,
  RELIVERSE_SCHEMA_URL,
  RELIVERSE_SCHEMA_DEV,
  cliName,
  cliDomainDocs,
  cliConfigJsonc,
} from "~/app/constants.js";
import { getBiomeConfig } from "~/utils/configHandler.js";

import {
  reliverseConfigSchema,
  type ProjectFramework,
  type ReliverseConfig,
} from "./schemaConfig.js";
import { getCurrentWorkingDirectory } from "./terminalHelpers.js";

/* ------------------------------------------------------------------
 * Constants & Utility Extensions
 * ------------------------------------------------------------------ */

// Extensions for backup and temp files
const BACKUP_EXTENSION = ".backup";
const TEMP_EXTENSION = ".tmp";

/* ------------------------------------------------------------------
 * TypeScript Types
 * ------------------------------------------------------------------ */

export type GenerateReliverseConfigOptions = {
  projectName: string;
  frontendUsername: string;
  deployService: DeploymentService;
  primaryDomain: string;
  projectPath: string;
  githubUsername: string;
  overwrite?: boolean;
  enableI18n?: boolean;
  isDev?: boolean;
};

export type ProjectFeatures = {
  i18n: boolean;
  analytics: boolean;
  themeMode: "light" | "dark" | "dark-light";
  authentication: boolean;
  api: boolean;
  database: boolean;
  testing: boolean;
  docker: boolean;
  ci: boolean;
  commands: string[];
  webview: string[];
  language: string[];
  themes: string[];
};

/* ------------------------------------------------------------------
 * Re-reading the reliverse.jsonc File
 * ------------------------------------------------------------------ */

/**
 * Attempts to read the reliverse.jsonc config from the current working directory.
 * If the file is not valid, it attempts a line-by-line fix.
 */
export async function reReadReliverseConfig(): Promise<ReliverseConfig | null> {
  const cwd = getCurrentWorkingDirectory();
  const configPath = path.join(cwd, cliConfigJsonc);

  // First try normal read
  let config = await readReliverseConfig(configPath);

  // If not valid, attempt a line-by-line fix
  if (!config) {
    config = await parseAndFixConfig(configPath);
  }

  return config;
}

/* ------------------------------------------------------------------
 * Detecting Project Framework
 * ------------------------------------------------------------------ */

export const PROJECT_FRAMEWORK_FILES: Record<ProjectFramework, string[]> = {
  unknown: [],
  "npm-jsr": ["jsr.json", "jsr.jsonc", "build.publish.ts"],
  astro: ["astro.config.js", "astro.config.ts", "astro.config.mjs"],
  nextjs: ["next.config.js", "next.config.ts", "next.config.mjs"],
  vite: ["vite.config.js", "vite.config.ts", "react.config.js"],
  svelte: ["svelte.config.js", "svelte.config.ts"],
  vue: ["vue.config.js", "vite.config.ts"],
  wxt: ["wxt.config.js", "wxt.config.ts"],
  vscode: ["vscode.config.js", "vscode.config.ts"],
};

export async function detectProjectFramework(
  cwd: string,
): Promise<ProjectFramework | null> {
  for (const [type, files] of Object.entries(PROJECT_FRAMEWORK_FILES)) {
    for (const file of files) {
      if (await fs.pathExists(path.join(cwd, file))) {
        return type as ProjectFramework;
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------
 * Update Project Config
 * ------------------------------------------------------------------ */

/**
 * Deep merges two objects recursively while preserving nested structures.
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };
  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;

    const sourceValue = source[key];
    const targetValue = target[key];

    if (sourceValue !== undefined) {
      if (
        sourceValue !== null &&
        typeof sourceValue === "object" &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        typeof targetValue === "object" &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>,
        ) as T[Extract<keyof T, string>];
      } else {
        result[key] = sourceValue as T[Extract<keyof T, string>];
      }
    }
  }
  return result;
}

/**
 * Updates project configuration by merging new updates with the existing config.
 * Creates a backup before overwriting and attempts to restore from backup on error.
 */
export async function updateReliverseConfig(
  projectPath: string,
  updates: Partial<ReliverseConfig>,
): Promise<boolean> {
  const configPath = path.join(projectPath, cliConfigJsonc);
  const backupPath = configPath + BACKUP_EXTENSION;
  const tempPath = configPath + TEMP_EXTENSION;

  try {
    let existingConfig: ReliverseConfig = {} as ReliverseConfig;
    let existingContent = "";

    // Read and validate existing config if it exists
    if (await fs.pathExists(configPath)) {
      existingContent = await fs.readFile(configPath, "utf-8");
      const parsed = parseJSONC(existingContent);
      if (Value.Check(reliverseConfigSchema, parsed)) {
        existingConfig = parsed;
      } else {
        relinka("warn", "Invalid reliverse.jsonc schema, starting fresh");
      }
    }

    // Merge updates with the existing config
    const mergedConfig = deepMerge(existingConfig, updates);

    // Validate final config
    if (!Value.Check(reliverseConfigSchema, mergedConfig)) {
      const issues = [...Value.Errors(reliverseConfigSchema, mergedConfig)].map(
        (err) => `Path "${err.path}": ${err.message}`,
      );
      relinka(
        "error",
        "Invalid reliverse.jsonc config after merge:",
        issues.join("; "),
      );
      return false;
    }

    // Create a backup if the file exists
    if (await fs.pathExists(configPath)) {
      await fs.copy(configPath, backupPath);
    }

    // Write to a temporary file first (atomic write)
    let fileContent = JSON.stringify(mergedConfig, null, 2);
    fileContent = injectSectionComments(fileContent);
    await fs.writeFile(tempPath, fileContent);

    // Rename temp file to actual config file
    await fs.rename(tempPath, configPath);

    // Remove backup on success
    if (await fs.pathExists(backupPath)) {
      await fs.remove(backupPath);
    }

    relinka("success", "Reliverse config updated successfully");
    return true;
  } catch (error) {
    relinka("error", "Failed to update reliverse.jsonc config:", String(error));
    // Attempt to restore from backup if write failed
    if (
      (await fs.pathExists(backupPath)) &&
      !(await fs.pathExists(configPath))
    ) {
      try {
        await fs.copy(backupPath, configPath);
        relinka("warn", "Restored config from backup after failed update");
      } catch (restoreError) {
        relinka(
          "error",
          "Failed to restore config from backup:",
          String(restoreError),
        );
      }
    }
    // Clean up temporary file if it exists
    if (await fs.pathExists(tempPath)) {
      await fs.remove(tempPath);
    }
    return false;
  }
}

/**
 * Migrates an external reliverse.jsonc file into the current project config.
 * Only migrates fields that exist in the current schema.
 */
export async function migrateReliverseConfig(
  externalReliverseFilePath: string,
  projectPath: string,
) {
  try {
    const content = await fs.readFile(externalReliverseFilePath, "utf-8");
    const parsed = parseJSONC(content);

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid JSONC format in reliverse-tmp.jsonc");
    }

    const tempConfig = parsed as Partial<ReliverseConfig>;
    const migratedFields: string[] = [];
    // Declare validConfig as a partial record keyed by ReliverseConfig keys.
    const validConfig = {} as Partial<Record<keyof ReliverseConfig, unknown>>;

    // List of keys to consider for migration
    const keysToMigrate: (keyof ReliverseConfig)[] = [
      "projectDescription",
      "version",
      "projectLicense",
      "projectRepository",
      "projectCategory",
      "projectSubcategory",
      "projectFramework",
      "projectTemplate",
      "projectArchitecture",
      "deployBehavior",
      "depsBehavior",
      "gitBehavior",
      "i18nBehavior",
      "scriptsBehavior",
      "existingRepoBehavior",
      "repoPrivacy",
      "features",
      "preferredLibraries",
      "codeStyle",
      "monorepo",
      "ignoreDependencies",
      "customRules",
      "skipPromptsUseAutoBehavior",
    ];

    for (const key of keysToMigrate) {
      if (tempConfig[key] !== undefined) {
        // Using the type assertion to assign the value into our validConfig.
        validConfig[key] = tempConfig[key];
        migratedFields.push(String(key));
      }
    }

    // Update the reliverse.jsonc config with migrated data
    const success = await updateReliverseConfig(
      projectPath,
      validConfig as Partial<ReliverseConfig>,
    );

    if (success) {
      relinka("success", "Successfully migrated reliverse.jsonc config");
      relinka("success-verbose", "Migrated fields:", migratedFields.join(", "));
    }

    // Clean up external file after migration
    await fs.remove(externalReliverseFilePath);
  } catch (error) {
    relinka(
      "warn",
      "Failed to migrate data from reliverse-tmp.jsonc:",
      String(error),
    );
  }
}

/* ------------------------------------------------------------------
 * Default Config and Merging Logic
 * ------------------------------------------------------------------ */

export const DEFAULT_CONFIG: ReliverseConfig = {
  $schema: RELIVERSE_SCHEMA_URL,
  projectName: UNKNOWN_VALUE,
  projectAuthor: UNKNOWN_VALUE,
  projectDescription: UNKNOWN_VALUE,
  version: "0.1.0",
  projectLicense: "MIT",
  projectState: "creating",
  projectRepository: DEFAULT_DOMAIN,
  projectDomain: DEFAULT_DOMAIN,
  projectCategory: UNKNOWN_VALUE,
  projectSubcategory: UNKNOWN_VALUE,
  projectTemplate: UNKNOWN_VALUE,
  projectArchitecture: UNKNOWN_VALUE,
  repoPrivacy: UNKNOWN_VALUE,
  projectGitService: "github",
  projectDeployService: "vercel",
  repoBranch: "main",
  projectFramework: "nextjs",
  projectPackageManager: (await isBunPM()) ? "bun" : "npm",
  projectRuntime: runtimeInfo?.name || "node",
  preferredLibraries: {
    stateManagement: "zustand",
    formManagement: "react-hook-form",
    styling: "tailwind",
    uiComponents: "shadcn-ui",
    testing: "bun",
    authentication: "clerk",
    database: "drizzle",
    api: "trpc",
  },
  monorepo: {
    type: "none",
    packages: [],
    sharedPackages: [],
  },
  ignoreDependencies: [],
  customRules: {},
  features: {
    i18n: false,
    analytics: false,
    themeMode: "dark-light",
    authentication: true,
    api: true,
    database: true,
    testing: false,
    docker: false,
    ci: false,
    commands: [],
    webview: [],
    language: [],
    themes: [],
  },
  codeStyle: {
    dontRemoveComments: true,
    shouldAddComments: true,
    typeOrInterface: "type",
    importOrRequire: "import",
    quoteMark: "double",
    semicolons: true,
    lineWidth: 80,
    indentStyle: "space",
    indentSize: 2,
    importSymbol: "~",
    trailingComma: "all",
    bracketSpacing: true,
    arrowParens: "always",
    tabWidth: 2,
    jsToTs: false,
    cjsToEsm: false,
    modernize: {
      replaceFs: false,
      replacePath: false,
      replaceHttp: false,
      replaceProcess: false,
      replaceConsole: false,
      replaceEvents: false,
    },
  },
  multipleRepoCloneMode: false,
  customUserFocusedRepos: [],
  customDevsFocusedRepos: [],
  hideRepoSuggestions: false,
  customReposOnNewProject: false,
  envComposerOpenBrowser: true,
  skipPromptsUseAutoBehavior: false,
  deployBehavior: "prompt",
  depsBehavior: "prompt",
  gitBehavior: "prompt",
  i18nBehavior: "prompt",
  scriptsBehavior: "prompt",
  existingRepoBehavior: "prompt",
};

function mergeWithDefaults(partial: Partial<ReliverseConfig>): ReliverseConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    features: {
      ...DEFAULT_CONFIG.features,
      ...(partial.features ?? {}),
    },
    codeStyle: {
      ...DEFAULT_CONFIG.codeStyle,
      ...(partial.codeStyle ?? {}),
      modernize: {
        ...DEFAULT_CONFIG.codeStyle.modernize,
        ...(partial.codeStyle?.modernize ?? {}),
      },
    },
    preferredLibraries: {
      ...DEFAULT_CONFIG.preferredLibraries,
      ...(partial.preferredLibraries ?? {}),
    },
    monorepo: {
      ...DEFAULT_CONFIG.monorepo,
      ...(partial.monorepo ?? {}),
    },
    customRules: {
      ...DEFAULT_CONFIG.customRules,
      ...(partial.customRules ?? {}),
    },
    ignoreDependencies:
      partial.ignoreDependencies ?? DEFAULT_CONFIG.ignoreDependencies,
  };
}

/* ------------------------------------------------------------------
 * Fixing Config Line-by-Line
 * ------------------------------------------------------------------ */

/**
 * Creates a schema for a single property so that it can be validated in isolation.
 */
function createSinglePropertySchema(key: string, subSchema: TSchema): TSchema {
  return Type.Object({ [key]: subSchema } as Record<string, TSchema>, {
    additionalProperties: false,
    required: [key],
  });
}

/**
 * Validates a single property against its schema.
 */
function fixSingleProperty(
  schema: TSchema,
  propName: string,
  userValue: unknown,
  defaultValue: unknown,
): unknown {
  const singlePropertySchema = createSinglePropertySchema(propName, schema);
  const testObject = { [propName]: userValue };

  const isValid = Value.Check(singlePropertySchema, testObject);
  return isValid ? userValue : defaultValue;
}

/**
 * Recursively fixes each property in the object. Returns the fixed config and
 * an array of property paths that were changed.
 */
export function fixLineByLine(
  userConfig: unknown,
  defaultConfig: unknown,
  schema: TSchema,
): { fixedConfig: unknown; changedKeys: string[] } {
  const isObjectSchema =
    (schema as any).type === "object" && (schema as any).properties;

  if (
    !isObjectSchema ||
    typeof userConfig !== "object" ||
    userConfig === null
  ) {
    const isValid = Value.Check(schema, userConfig);
    return {
      fixedConfig: isValid ? userConfig : defaultConfig,
      changedKeys: isValid ? [] : ["<entire_object>"],
    };
  }

  const properties = (schema as any).properties as Record<string, TSchema>;
  const result: Record<string, unknown> = { ...((defaultConfig as any) ?? {}) };
  const changedKeys: string[] = [];
  const missingKeys: string[] = [];

  for (const propName of Object.keys(properties)) {
    const subSchema = properties[propName];
    const userValue = (userConfig as any)[propName];
    const defaultValue = (defaultConfig as any)[propName];

    if (userValue === undefined && !(propName in userConfig)) {
      missingKeys.push(propName);
      result[propName] = defaultValue;
      continue;
    }

    // Special handling for repository arrays
    if (
      propName === "customUserFocusedRepos" ||
      propName === "customDevsFocusedRepos"
    ) {
      if (Array.isArray(userValue)) {
        result[propName] = userValue.map((url) => cleanGitHubUrl(String(url)));
        continue;
      }
    }

    const isValidStructure = Value.Check(
      createSinglePropertySchema(propName, subSchema!),
      { [propName]: userValue },
    );

    if (!isValidStructure) {
      result[propName] = defaultValue;
      changedKeys.push(propName);
    } else if (
      subSchema &&
      typeof subSchema === "object" &&
      "type" in subSchema &&
      subSchema["type"] === "object"
    ) {
      const { fixedConfig, changedKeys: nestedChanges } = fixLineByLine(
        userValue,
        defaultValue,
        subSchema,
      );
      result[propName] = fixedConfig;
      if (nestedChanges.length > 0) {
        changedKeys.push(...nestedChanges.map((nc) => `${propName}.${nc}`));
      }
    } else {
      const originalValue = userValue;
      const validatedValue = fixSingleProperty(
        subSchema!,
        propName,
        userValue,
        defaultValue,
      );
      result[propName] = validatedValue;
      if (originalValue !== undefined && validatedValue !== originalValue) {
        changedKeys.push(propName);
      }
    }
  }

  if (missingKeys.length > 0) {
    relinka(
      "info-verbose",
      "Missing fields injected from default config:",
      missingKeys.join(", "),
    );
  }

  return { fixedConfig: result, changedKeys };
}

/* ------------------------------------------------------------------
 * Comment Injection
 * ------------------------------------------------------------------ */

type CommentSections = Partial<Record<keyof ReliverseConfig, string[]>>;

export function injectSectionComments(fileContent: string): string {
  const comment = (text: string) => (text ? `// ${text}` : "");

  const commentSections: CommentSections = {
    $schema: [
      comment(`RELIVERSE CONFIG (${cliDomainDocs})`),
      comment(`This jsonc file is generated by ${cliName}`),
      comment("Restart the CLI to apply your config changes"),
    ],
    projectName: [comment("General project information")],
    skipPromptsUseAutoBehavior: [
      comment(
        "Enable auto-answering for prompts to skip manual confirmations.",
      ),
      comment("Make sure you have unknown values configured above."),
    ],
    features: [comment("Project features")],
    projectFramework: [comment("Primary tech stack/framework")],
    codeStyle: [comment("Code style preferences")],
    multipleRepoCloneMode: [comment("Settings for cloning an existing repo")],
    envComposerOpenBrowser: [
      comment(
        "Set to false to disable opening the browser during env composing",
      ),
    ],
    ignoreDependencies: [comment("List dependencies to exclude from checks")],
    customRules: [comment("Custom rules for Reliverse AI")],
    deployBehavior: [
      comment("Prompt behavior for deployment"),
      comment("Options: prompt | autoYes | autoNo"),
    ],
    existingRepoBehavior: [
      comment("Behavior for existing GitHub repos during project creation"),
      comment("Options: prompt | autoYes | autoYesSkipCommit | autoNo"),
    ],
  };

  for (const [section, lines] of Object.entries(commentSections)) {
    if (!lines?.length) continue;
    const combinedComments = lines
      .map((line, idx) => (idx === 0 ? line : `  ${line}`))
      .join("\n");

    fileContent = fileContent.replace(
      new RegExp(`(\\s+)"${section.replace("$", "\\$")}":`, "g"),
      `\n\n  ${combinedComments}\n  "${section}":`,
    );
  }

  return fileContent
    .replace(/\n{3,}/g, "\n\n")
    .replace(/{\n\n/g, "{\n")
    .replace(/\n\n}/g, "\n}")
    .trim()
    .concat("\n");
}

/* ------------------------------------------------------------------
 * Config Read/Write (TypeBox)
 * ------------------------------------------------------------------ */

/**
 * Parses the reliverse.jsonc file and validates it against the schema.
 * Returns both the parsed object and any errors (if present).
 */
async function parseReliverseFile(configPath: string): Promise<{
  parsed: unknown;
  errors: Iterable<{
    schema: unknown;
    path: string;
    value: unknown;
    message: string;
  }> | null;
} | null> {
  try {
    const content = (await fs.readFile(configPath, "utf-8")).trim();
    if (!content || content === "{}") {
      return null;
    }

    const parsed = parseJSONC(content);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const isValid = Value.Check(reliverseConfigSchema, parsed);
    if (!isValid) {
      return {
        parsed,
        errors: Value.Errors(reliverseConfigSchema, parsed),
      };
    }

    return { parsed, errors: null };
  } catch {
    return null;
  }
}

/**
 * Writes the given ReliverseConfig to the config file.
 * Uses an atomic write (via a temporary file) and creates a backup.
 */
export async function writeReliverseConfig(
  configPath: string,
  config: ReliverseConfig,
): Promise<void> {
  const backupPath = configPath + BACKUP_EXTENSION;
  const tempPath = configPath + TEMP_EXTENSION;

  try {
    const valid = Value.Check(reliverseConfigSchema, config);
    if (!valid) {
      const issues = [...Value.Errors(reliverseConfigSchema, config)].map(
        (err) => `Path "${err.path}": ${err.message}`,
      );
      relinka("error", "Invalid reliverse.jsonc config:", issues.join("; "));
      throw new Error(`Invalid reliverse.jsonc config: ${issues.join("; ")}`);
    }

    let fileContent = JSON.stringify(config, null, 2);
    fileContent = injectSectionComments(fileContent);

    if (await fs.pathExists(configPath)) {
      await fs.copy(configPath, backupPath);
    }

    await fs.writeFile(tempPath, fileContent);
    await fs.rename(tempPath, configPath);

    if (await fs.pathExists(backupPath)) {
      await fs.remove(backupPath);
    }

    relinka("success-verbose", "Config written successfully");
  } catch (error) {
    if (
      (await fs.pathExists(backupPath)) &&
      !(await fs.pathExists(configPath))
    ) {
      await fs.copy(backupPath, configPath);
      relinka("warn", "Restored config from backup after failed write");
    }
    if (await fs.pathExists(tempPath)) {
      await fs.remove(tempPath);
    }
    throw error;
  }
}

/**
 * Reads and validates the reliverse.jsonc config file.
 * If errors are detected, it attempts to merge missing or invalid fields with defaults.
 */
export async function readReliverseConfig(
  configPath: string,
): Promise<ReliverseConfig | null> {
  if (!(await fs.pathExists(configPath))) {
    return null;
  }

  const backupPath = configPath + BACKUP_EXTENSION;
  const parseResult = await parseReliverseFile(configPath);
  if (!parseResult) {
    return null;
  }

  if (!parseResult.errors) {
    return parseResult.parsed as ReliverseConfig;
  }

  const errors = [...parseResult.errors].map(
    (err) => `Path "${err.path}": ${err.message}`,
  );
  relinka(
    "warn-verbose",
    "Detected invalid fields in reliverse.jsonc:",
    errors.join("; "),
  );

  const merged = mergeWithDefaults(
    parseResult.parsed as Partial<ReliverseConfig>,
  );
  if (Value.Check(reliverseConfigSchema, merged)) {
    await writeReliverseConfig(configPath, merged);
    relinka("info", "Merged missing or invalid fields into config");
    return merged;
  } else {
    if (await fs.pathExists(backupPath)) {
      const backupResult = await parseReliverseFile(backupPath);
      if (backupResult && !backupResult.errors) {
        await fs.copy(backupPath, configPath);
        relinka("info", "Restored config from backup");
        return backupResult.parsed as ReliverseConfig;
      }
      relinka("warn", "Backup also invalid. Returning null.");
      return null;
    }
    return null;
  }
}

/* ------------------------------------------------------------------
 * parseAndFixConfig (Line-by-Line)
 * ------------------------------------------------------------------ */

/**
 * Reads the reliverse.jsonc file, fixes invalid lines based on the schema,
 * writes back the fixed config, and returns the fixed config.
 */
async function parseAndFixConfig(
  configPath: string,
): Promise<ReliverseConfig | null> {
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = parseJSONC(raw);

    if (parsed && typeof parsed === "object") {
      const originalErrors = [...Value.Errors(reliverseConfigSchema, parsed)];
      if (originalErrors.length === 0) {
        return parsed as ReliverseConfig;
      }

      const { fixedConfig, changedKeys } = fixLineByLine(
        parsed,
        DEFAULT_CONFIG,
        reliverseConfigSchema,
      );

      if (Value.Check(reliverseConfigSchema, fixedConfig)) {
        await writeReliverseConfig(configPath, fixedConfig);
        const originalInvalidPaths = originalErrors.map((err) => err.path);
        relinka(
          "info",
          "Your reliverse.jsonc config has been fixed. Please ensure it aligns with your project.",
          `Changed keys: ${changedKeys.join(", ") || "(none)"}`,
        );
        relinka(
          "info-verbose",
          `Originally invalid paths were: ${originalInvalidPaths.join(", ") || "(none)"}`,
        );
        return fixedConfig;
      } else {
        const newErrs = [
          ...Value.Errors(reliverseConfigSchema, fixedConfig),
        ].map((e) => `Path "${e.path}": ${e.message}`);
        relinka(
          "warn",
          "Could not fix all invalid config lines:",
          newErrs.join("; "),
        );
        return null;
      }
    }
  } catch (error) {
    relinka(
      "warn",
      "Failed to parse/fix reliverse.jsonc line-by-line:",
      error instanceof Error ? error.message : String(error),
    );
  }
  return null;
}

/* ------------------------------------------------------------------
 * Generating a Default Config and Merging with Detected Data
 * ------------------------------------------------------------------ */

export async function getDefaultReliverseConfig(
  cwd: string,
  projectName?: string,
  projectAuthor?: string,
): Promise<ReliverseConfig> {
  const packageJson = await getPackageJsonSafe(cwd);
  const effectiveProjectName =
    packageJson?.name ?? projectName ?? UNKNOWN_VALUE;

  let effectiveProjectAuthor =
    typeof packageJson?.author === "object"
      ? (packageJson.author?.name ?? projectAuthor)
      : (packageJson?.author ?? projectAuthor ?? UNKNOWN_VALUE);

  // Handle dev mode author replacement
  if (effectiveProjectAuthor === "reliverse") {
    effectiveProjectAuthor = "blefnk";
  }

  const biomeConfig = await getBiomeConfig(cwd);
  const detectedPkgManager = await getUserPkgManager(cwd);

  const packageJsonPath = path.join(cwd, "package.json");
  let packageData: PackageJson = {
    name: effectiveProjectName,
    author: effectiveProjectAuthor,
  };

  if (await fs.pathExists(packageJsonPath)) {
    try {
      packageData = await readPackageJSON(cwd);
    } catch {
      // fallback if reading fails
    }
  }

  const detectedProjectFramework = await detectProjectFramework(cwd);

  return {
    ...DEFAULT_CONFIG,
    projectName: effectiveProjectName,
    projectAuthor: effectiveProjectAuthor,
    projectDescription: packageData.description ?? UNKNOWN_VALUE,
    version: packageData.version ?? "0.1.0",
    projectLicense: packageData.license ?? "MIT",
    projectRepository:
      typeof packageData.repository === "string"
        ? packageData.repository
        : (packageData.repository?.url ?? DEFAULT_DOMAIN),
    projectState: "creating",
    projectDomain:
      effectiveProjectName === cliName ? cliDomainDocs : DEFAULT_DOMAIN,
    projectGitService: "github",
    projectDeployService: "vercel",
    projectCategory: UNKNOWN_VALUE,
    projectSubcategory: UNKNOWN_VALUE,
    projectTemplate: UNKNOWN_VALUE,
    projectArchitecture: UNKNOWN_VALUE,
    repoPrivacy: UNKNOWN_VALUE,
    repoBranch: "main",
    projectFramework: detectedProjectFramework ?? UNKNOWN_VALUE,
    projectPackageManager: detectedPkgManager.packageManager,
    projectRuntime: runtimeInfo?.name || "node",
    codeStyle: {
      ...DEFAULT_CONFIG.codeStyle,
      lineWidth: biomeConfig?.lineWidth ?? 80,
      indentSize: biomeConfig?.indentWidth ?? 2,
      tabWidth: biomeConfig?.indentWidth ?? 2,
    },
  };
}

/* ------------------------------------------------------------------
 * Project Detection and Additional Logic
 * ------------------------------------------------------------------ */

async function checkProjectFiles(projectPath: string): Promise<{
  hasReliverse: boolean;
  hasPackageJson: boolean;
  hasNodeModules: boolean;
  hasGit: boolean;
}> {
  const [hasReliverse, hasPackageJson, hasNodeModules, hasGit] =
    await Promise.all([
      fs.pathExists(path.join(projectPath, cliConfigJsonc)),
      fs.pathExists(path.join(projectPath, "package.json")),
      fs.pathExists(path.join(projectPath, "node_modules")),
      fs.pathExists(path.join(projectPath, ".git")),
    ]);

  return { hasReliverse, hasPackageJson, hasNodeModules, hasGit };
}

export type DetectedProject = {
  name: string;
  path: string;
  config: ReliverseConfig;
  gitStatus?: {
    uncommittedChanges: number;
    unpushedCommits: number;
  };
  needsDepsInstall?: boolean;
  hasGit?: boolean;
};

/* ------------------------------------------------------------------
 * Reliverse Config Creation (wrapper around config generator and fixer)
 * ------------------------------------------------------------------ */

async function createReliverseConfig(
  cwd: string,
  githubUsername: string,
  isDev: boolean,
): Promise<void> {
  const defaultRules = await generateDefaultRulesForProject(cwd);

  const effectiveProjectName = defaultRules?.projectName ?? path.basename(cwd);
  let effectiveAuthorName = defaultRules?.projectAuthor ?? UNKNOWN_VALUE;
  const effectiveDomain =
    defaultRules?.projectDomain ??
    (effectiveProjectName === cliName ? cliDomainDocs : DEFAULT_DOMAIN);

  if (isDev) {
    effectiveAuthorName =
      effectiveAuthorName === "reliverse" ? "blefnk" : effectiveAuthorName;
  }

  await generateReliverseConfig({
    projectName: effectiveProjectName,
    frontendUsername: effectiveAuthorName,
    deployService: "vercel",
    primaryDomain: effectiveDomain,
    projectPath: cwd,
    githubUsername,
    isDev,
  });

  relinka(
    "info-verbose",
    defaultRules
      ? "Created reliverse.jsonc configuration based on detected project settings."
      : "Created initial reliverse.jsonc configuration. Please review and adjust as needed.",
  );
}

/* ------------------------------------------------------------------
 * Multi-config Reading from `reli` Folder
 * ------------------------------------------------------------------ */

/**
 * Reads all `*reliverse.jsonc` files in the `reli` folder, parses and
 * fixes them if needed. Returns an array of valid ReliverseConfigs.
 */
export async function readReliverseConfigsInReliFolder(
  cwd: string,
): Promise<ReliverseConfig[]> {
  const reliFolderPath = path.join(cwd, "reli");
  const results: ReliverseConfig[] = [];

  if (!(await fs.pathExists(reliFolderPath))) {
    return results;
  }

  const dirItems = await fs.readdir(reliFolderPath);
  const reliverseFiles = dirItems.filter((item) =>
    item.endsWith(cliConfigJsonc),
  );

  // Process each file concurrently
  const configs = await Promise.all(
    reliverseFiles.map(async (file) => {
      const filePath = path.join(reliFolderPath, file);
      let config = await readReliverseConfig(filePath);
      if (!config) {
        config = await parseAndFixConfig(filePath);
      }
      if (!config) {
        relinka("warn", `Skipping invalid config file: ${filePath}`);
      }
      return config;
    }),
  );

  return configs.filter((cfg): cfg is ReliverseConfig => cfg !== null);
}

/* ------------------------------------------------------------------
 * Clean GitHub URL
 * ------------------------------------------------------------------ */

/**
 * Cleans GitHub repository URLs by removing git+ prefix and .git suffix.
 */
export function cleanGitHubUrl(url: string): string {
  return url
    .trim()
    .replace(/^git\+/, "")
    .replace(
      /^https?:\/\/(www\.)?(github|gitlab|bitbucket|sourcehut)\.com\//i,
      "",
    )
    .replace(/^(github|gitlab|bitbucket|sourcehut)\.com\//i, "")
    .replace(/\.git$/i, "");
}

/* ------------------------------------------------------------------
 * Generating Default Rules for Project
 * ------------------------------------------------------------------ */

export async function generateDefaultRulesForProject(
  cwd: string,
): Promise<ReliverseConfig | null> {
  const projectCategory = await detectProjectFramework(cwd);
  const effectiveProjectCategory = projectCategory ?? "nextjs";

  const packageJsonPath = path.join(cwd, "package.json");
  let packageJson: any = {};

  if (await fs.pathExists(packageJsonPath)) {
    try {
      packageJson = safeDestr(await fs.readFile(packageJsonPath, "utf-8"));
    } catch {
      // ignore
    }
  }

  const rules = await getDefaultReliverseConfig(cwd);

  if (!projectCategory) {
    rules.features = {
      ...DEFAULT_CONFIG.features,
      language: ["typescript"],
      themes: ["default"],
    };
    rules.preferredLibraries = {
      ...DEFAULT_CONFIG.preferredLibraries,
      database: "drizzle",
      authentication: "clerk",
    };
    return rules;
  }

  const hasPrisma = await fs.pathExists(path.join(cwd, "prisma/schema.prisma"));
  const hasDrizzle = await fs.pathExists(path.join(cwd, "drizzle.config.ts"));
  const hasNextAuth = await fs.pathExists(
    path.join(cwd, "src/app/api/auth/[...nextauth]"),
  );
  const hasClerk = packageJson.dependencies?.["@clerk/nextjs"];

  rules.features = {
    ...rules.features,
    database: hasPrisma || hasDrizzle,
    authentication: hasNextAuth || hasClerk,
    analytics: false,
    themeMode: "dark-light",
    api: true,
    testing: false,
    docker: false,
    ci: false,
    commands: [],
    webview: [],
    language: ["typescript"],
    themes: ["default"],
  };

  if (!rules.preferredLibraries) {
    rules.preferredLibraries = {};
  }

  if (effectiveProjectCategory === "nextjs") {
    rules.preferredLibraries["database"] = "prisma";
    rules.preferredLibraries["authentication"] = "next-auth";
  } else {
    rules.preferredLibraries["database"] = "drizzle";
    rules.preferredLibraries["authentication"] = "clerk";
  }

  return rules;
}

/* ------------------------------------------------------------------
 * Project Detection & Additional Logic
 * ------------------------------------------------------------------ */

async function getPackageJson(
  projectPath: string,
): Promise<PackageJson | null> {
  try {
    const packageJsonPath = path.join(projectPath, "package.json");
    if (!(await fs.pathExists(packageJsonPath))) {
      return null;
    }
    return await readPackageJSON(projectPath);
  } catch (error) {
    const packageJsonPath = path.join(projectPath, "package.json");
    if (await fs.pathExists(packageJsonPath)) {
      relinka(
        "warn",
        "Could not read package.json:",
        error instanceof Error ? error.message : String(error),
      );
    }
    return null;
  }
}

export async function getPackageJsonSafe(
  cwd: string,
): Promise<PackageJson | null> {
  const packageJsonPath = path.join(cwd, "package.json");
  if (!(await fs.pathExists(packageJsonPath))) {
    return null;
  }
  return await readPackageJSON(cwd);
}

export async function detectProject(
  projectPath: string,
): Promise<DetectedProject | null> {
  try {
    const { hasReliverse, hasPackageJson, hasNodeModules, hasGit } =
      await checkProjectFiles(projectPath);

    if (!hasReliverse || !hasPackageJson) return null;

    const configContent = await fs.readFile(
      path.join(projectPath, cliConfigJsonc),
      "utf-8",
    );
    const parsedConfig = parseJSONC(configContent);
    const config = destr<ReliverseConfig>(parsedConfig);

    return {
      name: path.basename(projectPath),
      path: projectPath,
      config,
      needsDepsInstall: !hasNodeModules,
      hasGit,
    };
  } catch (error) {
    relinka(
      "warn",
      `Error processing ${projectPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

export async function detectProjectsWithReliverse(
  cwd: string,
): Promise<DetectedProject[]> {
  const detected: DetectedProject[] = [];

  const rootProject = await detectProject(cwd);
  if (rootProject) {
    detected.push(rootProject);
  }

  try {
    const items = await fs.readdir(cwd, { withFileTypes: true });
    // Process directories concurrently
    const subProjects = await Promise.all(
      items
        .filter((item) => item.isDirectory())
        .map(async (item) => {
          const projectPath = path.join(cwd, item.name);
          return await detectProject(projectPath);
        }),
    );
    for (const project of subProjects) {
      if (project) {
        detected.push(project);
      }
    }
  } catch (error) {
    relinka(
      "warn",
      `Error reading directory ${cwd}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return detected;
}

/* ------------------------------------------------------------------
 * Feature Detection
 * ------------------------------------------------------------------ */

export async function detectFeatures(
  projectPath: string,
  packageJson: PackageJson | null,
): Promise<ProjectFeatures> {
  const deps = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };

  const hasNextAuth = "next-auth" in deps;
  const hasClerk = "@clerk/nextjs" in deps;
  const hasPrisma = "@prisma/client" in deps;
  const hasDrizzle = "drizzle-orm" in deps;
  const hasAnalytics =
    "@vercel/analytics" in deps || "@segment/analytics-next" in deps;
  const hasDocker = await fs.pathExists(path.join(projectPath, "Dockerfile"));
  const hasCI =
    (await fs.pathExists(path.join(projectPath, ".github/workflows"))) ||
    (await fs.pathExists(path.join(projectPath, ".gitlab-ci.yml")));
  const hasTesting =
    "jest" in deps || "vitest" in deps || "@testing-library/react" in deps;

  return {
    i18n: false,
    analytics: hasAnalytics,
    themeMode: "dark-light",
    authentication: hasNextAuth || hasClerk,
    api: true,
    database: hasPrisma || hasDrizzle,
    testing: hasTesting,
    docker: hasDocker,
    ci: hasCI,
    commands: [],
    webview: [],
    language: ["typescript"],
    themes: ["default"],
  };
}

/* ------------------------------------------------------------------
 * Creating or Updating a Config
 * ------------------------------------------------------------------ */

export async function generateReliverseConfig({
  projectName,
  frontendUsername,
  deployService,
  primaryDomain,
  projectPath,
  githubUsername,
  enableI18n,
  overwrite,
  isDev,
}: GenerateReliverseConfigOptions): Promise<void> {
  const packageJson = await getPackageJson(projectPath);

  if (isDev) {
    frontendUsername =
      frontendUsername === "reliverse" ? "blefnk" : frontendUsername;
  }

  const baseRules = await getDefaultReliverseConfig(
    projectPath,
    projectName,
    frontendUsername,
  );

  baseRules.projectName = projectName;
  baseRules.projectAuthor = frontendUsername;
  baseRules.projectDescription =
    packageJson?.description ?? baseRules.projectDescription ?? UNKNOWN_VALUE;
  baseRules.version = packageJson?.version ?? baseRules.version;
  baseRules.projectLicense = packageJson?.license ?? baseRules.projectLicense;

  const projectNameWithoutAt = projectName?.replace("@", "");

  baseRules.projectRepository = packageJson?.repository
    ? typeof packageJson.repository === "string"
      ? cleanGitHubUrl(packageJson.repository)
      : cleanGitHubUrl(packageJson.repository.url)
    : githubUsername && projectName
      ? `https://github.com/${projectNameWithoutAt}`
      : DEFAULT_DOMAIN;

  baseRules.projectGitService = "github";
  baseRules.projectDeployService = deployService;
  baseRules.projectDomain = primaryDomain
    ? `https://${primaryDomain.replace(/^https?:\/\//, "")}`
    : projectName
      ? `https://${projectName}.vercel.app`
      : UNKNOWN_VALUE;

  baseRules.features = await detectFeatures(projectPath, packageJson);
  baseRules.features.i18n = enableI18n ?? false;

  baseRules.multipleRepoCloneMode = false;
  baseRules.customUserFocusedRepos = [];
  baseRules.customDevsFocusedRepos = [];
  baseRules.hideRepoSuggestions = false;
  baseRules.customReposOnNewProject = false;

  baseRules.envComposerOpenBrowser = true;

  baseRules.gitBehavior = "prompt";
  baseRules.deployBehavior = "prompt";
  baseRules.depsBehavior = "prompt";
  baseRules.i18nBehavior = "prompt";
  baseRules.scriptsBehavior = "prompt";
  baseRules.skipPromptsUseAutoBehavior = false;

  baseRules.codeStyle = {
    ...baseRules.codeStyle,
    dontRemoveComments: true,
    shouldAddComments: true,
    typeOrInterface: "type",
    importOrRequire: "import",
    quoteMark: "double",
    semicolons: true,
    lineWidth: 80,
    indentStyle: "space",
    indentSize: 2,
    importSymbol: "~",
    trailingComma: "all",
    bracketSpacing: true,
    arrowParens: "always",
    tabWidth: 2,
    jsToTs: false,
    cjsToEsm: false,
    modernize: {
      replaceFs: false,
      replacePath: false,
      replaceHttp: false,
      replaceProcess: false,
      replaceConsole: false,
      replaceEvents: false,
    },
  };

  const configPath = path.join(projectPath, cliConfigJsonc);
  let existingContent: ReliverseConfig | null = null;

  if (!overwrite && (await fs.pathExists(configPath))) {
    try {
      const content = await fs.readFile(configPath, "utf-8");
      existingContent = destr<ReliverseConfig>(content);
    } catch {
      // ignore errors
    }
  }

  const effectiveConfig = {
    ...DEFAULT_CONFIG,
    ...existingContent,
    ...baseRules,
  };

  // Update schema URL if in dev mode
  if (isDev) {
    effectiveConfig.$schema = RELIVERSE_SCHEMA_DEV;
  }

  await writeReliverseConfig(configPath, effectiveConfig);
}

/* ------------------------------------------------------------------
 * The Core Logic: Handle or Verify `reliverse.jsonc` + MULTI-CONFIG
 * ------------------------------------------------------------------ */

export async function getReliverseConfig(
  cwd: string,
  isDev: boolean,
): Promise<{ config: ReliverseConfig; reli: ReliverseConfig[] }> {
  const githubUsername = UNKNOWN_VALUE;

  // 1. Detect multi-config folder "reli"
  const reliFolderPath = path.join(cwd, "reli");
  const hasReliFolder = await fs.pathExists(reliFolderPath);
  let reliConfigs: ReliverseConfig[] = [];

  if (hasReliFolder) {
    reliConfigs = await readReliverseConfigsInReliFolder(cwd);
    if (reliConfigs.length > 0) {
      relinka(
        "info-verbose",
        `[🚨 Experimental] Detected ${reliConfigs.length} reliverse configs in reli folder...`,
      );
    }
  }

  // 2. Handle single reliverse.jsonc file in the root
  const configPath = path.join(cwd, cliConfigJsonc);
  if (!(await fs.pathExists(configPath))) {
    await createReliverseConfig(cwd, githubUsername, isDev);
  } else {
    const content = (await fs.readFile(configPath, "utf-8")).trim();
    if (!content || content === "{}") {
      await createReliverseConfig(cwd, githubUsername, isDev);
    } else {
      const validConfig = await readReliverseConfig(configPath);
      if (!validConfig) {
        const fixed = await parseAndFixConfig(configPath);
        if (!fixed) {
          relinka(
            "warn",
            "Could not fix existing reliverse.jsonc config. Using fallback defaults.",
          );
        }
      }
    }
  }

  const mainConfig = await readReliverseConfig(configPath);
  if (!mainConfig) {
    relinka(
      "warn",
      "Using fallback default config because reliverse.jsonc could not be validated.",
    );
    return { config: { ...DEFAULT_CONFIG }, reli: reliConfigs };
  }

  if (isDev) {
    mainConfig.$schema = RELIVERSE_SCHEMA_DEV;
  }

  return { config: mainConfig, reli: reliConfigs };
}
