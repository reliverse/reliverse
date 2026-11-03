import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { ConfigContractBundle } from "@reliverse/dcs-contract";
import {
  generateDcsReactUi,
  normalizeDcsUiPreset,
  type DcsReactUiGeneration,
  type DcsUiFramework,
  type DcsUiPreset,
} from "@reliverse/dcs-react";

export type DcsUiDoctorCheckStatus = "fail" | "pass" | "warn";

export interface DcsUiDoctorCheck {
  readonly code: string;
  readonly message: string;
  readonly status: DcsUiDoctorCheckStatus;
}

export interface DcsUiDoctorOptions {
  readonly cssFramework?: string;
  readonly framework?: string;
  readonly preset?: string;
  readonly workspaceRoot: string;
}

export interface DcsUiDoctorResult {
  readonly checks: readonly DcsUiDoctorCheck[];
  readonly compatible: boolean;
  readonly framework: DcsUiFramework;
  readonly globalCssPath?: string;
  readonly preset: DcsUiPreset;
  readonly workspaceRoot: string;
}

export interface GenerateDcsUiOptions extends DcsUiDoctorOptions {
  readonly bundle: ConfigContractBundle;
  readonly emitTheme?: boolean;
  readonly endpoint?: string;
  readonly force?: boolean;
  /** Path relative to workspace root, or absolute inside it. */
  readonly outputDirectory: string;
}

export interface GenerateDcsUiResult {
  readonly doctor: DcsUiDoctorResult;
  readonly generation: DcsReactUiGeneration;
  readonly outputDirectory: string;
  readonly unchanged: readonly string[];
  readonly written: readonly string[];
}

export class DcsUiProjectCompatibilityError extends Error {
  public readonly doctor: DcsUiDoctorResult;

  public constructor(doctor: DcsUiDoctorResult) {
    super(
      "DCS UI generation requires a compatible frontend project. Run dcs ui doctor for details.",
    );
    this.name = "DcsUiProjectCompatibilityError";
    this.doctor = doctor;
  }
}

export class DcsUiGeneratedSourceConflictError extends Error {
  public readonly location: string;

  public constructor(location: string) {
    super(
      `DCS refuses to overwrite modified generated UI source: ${location}. Pass --force only for files under your generated output directory.`,
    );
    this.name = "DcsUiGeneratedSourceConflictError";
    this.location = location;
  }
}

/**
 * Inspects a React/Tailwind v4/shadcn target without mutating it. The preset
 * intentionally validates semantic CSS variables and project-owned component
 * files before the code generator emits imports that would otherwise explode.
 */
export async function doctorDcsUiProject(options: DcsUiDoctorOptions): Promise<DcsUiDoctorResult> {
  const workspaceRoot = resolve(options.workspaceRoot);
  const preset = normalizeDcsUiPreset({
    ...(options.cssFramework === undefined ? {} : { cssFramework: options.cssFramework }),
    ...(options.preset === undefined ? {} : { preset: options.preset }),
  });
  const framework = normalizeFramework(options.framework);
  const checks: DcsUiDoctorCheck[] = [];

  const manifest = await readJsonObject(join(workspaceRoot, "package.json"));
  if (manifest === undefined) {
    checks.push(
      check("DCS7001", "package.json was not found at the selected workspace root.", "fail"),
    );
  } else {
    const reactVersion = dependencyVersion(manifest, "react");
    checks.push(
      reactVersion === undefined
        ? check("DCS7002", "React dependency is missing.", "fail")
        : check("DCS7002", `React dependency declared: ${reactVersion}.`, "pass"),
    );
  }

  if (preset === "react-headless") {
    return freezeDoctor({ checks, framework, preset, workspaceRoot });
  }

  const tailwindVersion =
    manifest === undefined ? undefined : dependencyVersion(manifest, "tailwindcss");
  checks.push(
    isTailwindV4(tailwindVersion)
      ? check("DCS7003", `Tailwind v4 dependency declared: ${tailwindVersion}.`, "pass")
      : check(
          "DCS7003",
          "tailwind-shadcn-v4 requires Tailwind CSS v4 in dependencies or devDependencies.",
          "fail",
        ),
  );

  const componentsPath = join(workspaceRoot, "components.json");
  const components = await readJsonObject(componentsPath);
  if (components === undefined) {
    checks.push(
      check(
        "DCS7004",
        "components.json was not found. Initialize the shadcn project integration first.",
        "fail",
      ),
    );
    return freezeDoctor({ checks, framework, preset, workspaceRoot });
  }

  const tailwind = asRecord(components.tailwind);
  const cssVariables = tailwind?.cssVariables === true;
  checks.push(
    cssVariables
      ? check("DCS7005", "components.json enables Tailwind CSS variables.", "pass")
      : check(
          "DCS7005",
          "tailwind-shadcn-v4 requires tailwind.cssVariables: true in components.json.",
          "fail",
        ),
  );

  const cssSetting = typeof tailwind?.css === "string" ? tailwind.css : undefined;
  const globalCssPath =
    cssSetting === undefined ? undefined : resolveInside(workspaceRoot, cssSetting);
  if (globalCssPath === undefined || !(await exists(globalCssPath))) {
    checks.push(
      check("DCS7006", "components.json does not point at an existing global CSS file.", "fail"),
    );
  } else {
    const css = await readFile(globalCssPath, "utf8");
    checks.push(
      css.includes('@import "tailwindcss"')
        ? check("DCS7007", "Global CSS imports Tailwind v4.", "pass")
        : check(
            "DCS7007",
            'Global CSS must include @import "tailwindcss" for the Tailwind v4 preset.',
            "fail",
          ),
    );
    const tokens = [
      "--color-background: var(--background)",
      "--color-primary: var(--primary)",
      "--color-border: var(--border)",
    ];
    checks.push(
      tokens.every((token) => css.includes(token))
        ? check("DCS7008", "Global CSS exposes semantic shadcn theme tokens to Tailwind.", "pass")
        : check(
            "DCS7008",
            "Global CSS must expose semantic background, primary, and border tokens through @theme inline.",
            "fail",
          ),
    );
  }

  const aliases = asRecord(components.aliases);
  const uiAlias = typeof aliases?.ui === "string" ? aliases.ui : "@/components/ui";
  const uiDirectory = resolveAliasDirectory(workspaceRoot, uiAlias);
  const required = ["button", "card", "input", "label", "select", "textarea"];
  for (const name of required) {
    const available = uiDirectory !== undefined && (await exists(join(uiDirectory, `${name}.tsx`)));
    checks.push(
      available
        ? check("DCS7009", `shadcn component available: ${name}.`, "pass")
        : check("DCS7009", `Required shadcn component is missing: ${name}.tsx.`, "fail"),
    );
  }

  return freezeDoctor({
    checks,
    framework,
    ...(globalCssPath === undefined ? {} : { globalCssPath }),
    preset,
    workspaceRoot,
  });
}

/**
 * Emits product-owned source files only. It never changes routes, package.json,
 * components.json, or global CSS imports. Generated source drift is protected
 * unless the caller explicitly opts into --force.
 */
export async function generateDcsUi(options: GenerateDcsUiOptions): Promise<GenerateDcsUiResult> {
  const doctor = await doctorDcsUiProject(options);
  if (!doctor.compatible) {
    throw new DcsUiProjectCompatibilityError(doctor);
  }
  const outputDirectory = resolveInside(doctor.workspaceRoot, options.outputDirectory);
  if (outputDirectory === undefined) {
    throw new TypeError("DCS UI output directory must remain inside the selected workspace root.");
  }
  const generation = await generateDcsReactUi({
    bundle: options.bundle,
    ...(options.emitTheme === true ? { emitTheme: true } : {}),
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    preset: doctor.preset,
  });
  const unchanged: string[] = [];
  const written: string[] = [];
  for (const generated of generation.files) {
    const location = join(outputDirectory, generated.filename);
    const existing = await readUtf8IfExists(location);
    if (existing === generated.content) {
      unchanged.push(generated.filename);
      continue;
    }
    if (existing !== undefined && options.force !== true) {
      throw new DcsUiGeneratedSourceConflictError(location);
    }
    await atomicWrite(location, generated.content);
    written.push(generated.filename);
  }
  return Object.freeze({
    doctor,
    generation,
    outputDirectory,
    unchanged: Object.freeze(unchanged),
    written: Object.freeze(written),
  });
}

function freezeDoctor(input: {
  readonly checks: readonly DcsUiDoctorCheck[];
  readonly framework: DcsUiFramework;
  readonly globalCssPath?: string;
  readonly preset: DcsUiPreset;
  readonly workspaceRoot: string;
}): DcsUiDoctorResult {
  const checks = Object.freeze(input.checks.map((entry) => Object.freeze({ ...entry })));
  return Object.freeze({
    checks,
    compatible: checks.every((entry) => entry.status !== "fail"),
    framework: input.framework,
    ...(input.globalCssPath === undefined ? {} : { globalCssPath: input.globalCssPath }),
    preset: input.preset,
    workspaceRoot: input.workspaceRoot,
  });
}

function check(code: string, message: string, status: DcsUiDoctorCheckStatus): DcsUiDoctorCheck {
  return Object.freeze({ code, message, status });
}

function normalizeFramework(value: string | undefined): DcsUiFramework {
  if (value === undefined || value === "react") {
    return "react";
  }
  throw new TypeError(
    `DCS UI supports only --framework react in this release; received ${JSON.stringify(value)}.`,
  );
}

function isTailwindV4(version: string | undefined): boolean {
  return version !== undefined && /^[~^<>=\s]*4(?:\.|$)/.test(version);
}

function dependencyVersion(manifest: Record<string, unknown>, name: string): string | undefined {
  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    const group = asRecord(manifest[key]);
    if (typeof group?.[name] === "string") return group[name];
  }
  return undefined;
}

function resolveAliasDirectory(workspaceRoot: string, alias: string): string | undefined {
  if (alias.startsWith("@/")) return join(workspaceRoot, "src", alias.slice(2));
  if (alias.startsWith("./") || alias.startsWith("../")) return resolveInside(workspaceRoot, alias);
  return undefined;
}

function resolveInside(root: string, candidate: string): string | undefined {
  const resolved = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);
  const relation = relative(root, resolved);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))
    ? resolved
    : undefined;
}

async function readJsonObject(location: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(location, "utf8"));
    return asRecord(parsed);
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

async function readUtf8IfExists(location: string): Promise<string | undefined> {
  try {
    return await readFile(location, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

async function exists(location: string): Promise<boolean> {
  return (await readUtf8IfExists(location)) !== undefined;
}

async function atomicWrite(location: string, content: string): Promise<void> {
  await mkdir(dirname(location), { recursive: true });
  const temporary = join(dirname(location), `.${basename(location)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, location);
  } finally {
    await rm(temporary, { force: true });
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
