import type { JsonObject, JsonValue } from "@reliverse/dcs-contract";

export interface PackageManifestOverrides {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly type?: "module" | "commonjs";
  readonly packageManager?: string;
  readonly engines?: { readonly bun?: string; readonly node?: string };
}
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
type MutableObject = { [key: string]: JsonValue };
const object = (value: JsonValue | undefined): MutableObject =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as MutableObject)
    : {};

/** Pure transformation only. The caller owns exact tree discovery, bytes and authority.
 * No dependency resolution, filesystem access, shell evaluation or package stubs. */
export function projectPackageManifest(input: {
  readonly source: JsonObject;
  readonly workspaces: readonly { readonly path: string; readonly manifest: JsonObject }[];
  readonly overrides?: PackageManifestOverrides;
  readonly publicationPaths?: readonly string[];
}) {
  const manifest: MutableObject = structuredClone(input.source);
  const blockers: string[] = [],
    notices: string[] = [];
  const names = new Map<string, string>();
  const workspaces = [...input.workspaces].sort((a, b) => a.path.localeCompare(b.path, "en"));
  for (const pkg of workspaces) {
    const name = pkg.manifest.name;
    if (typeof name !== "string" || !name || names.has(name))
      blockers.push(`Workspace ${pkg.path} needs a unique package name.`);
    else names.set(name, pkg.path);
  }
  const original = object(manifest.workspaces);
  manifest.workspaces = Array.isArray(manifest.workspaces)
    ? workspaces.map((pkg) => pkg.path)
    : { ...original, packages: workspaces.map((pkg) => pkg.path) };
  const catalog = object(original.catalog),
    catalogs = object(original.catalogs);
  const check = (owner: string, pkg: JsonObject, root: boolean) => {
    const registry = object(pkg.publishConfig).registry;
    if (
      registry !== undefined &&
      registry !== "https://registry.npmjs.org" &&
      registry !== "https://registry.npmjs.org/"
    )
      blockers.push(
        `${owner}: private/custom publication registry URLs require an explicit disclosure/resolver profile; only the public npm registry is supported.`,
      );
    for (const field of ["patchedDependencies", "installConfig", "resolutions"])
      if (pkg[field] !== undefined)
        blockers.push(
          `${owner}: ${field} requires a full-tree package-manager adapter; not supported in this preview.`,
        );
    if (
      pkg.overrides !== undefined &&
      /(?:workspace:|file:|link:|https?:|git\+|\.\.?\/|\/home\/|\/tmp\/)/.test(
        JSON.stringify(pkg.overrides),
      )
    )
      blockers.push(`${owner}: non-registry override resolution is not supported in this preview.`);
    for (const field of dependencyFields) {
      const deps = object(pkg[field]);
      for (const [name, raw] of Object.entries(deps)) {
        if (typeof raw !== "string") {
          blockers.push(`${owner}: invalid dependency ${name}.`);
          continue;
        }
        let spec = raw;
        if (spec.startsWith("catalog:")) {
          const key = spec.slice(8);
          const resolved = (key ? object(catalogs[key]) : catalog)[name];
          if (typeof resolved !== "string" || resolved.startsWith("catalog:")) {
            blockers.push(`${owner}: missing or recursive catalog entry for ${name}.`);
            continue;
          }
          spec = resolved;
        }
        if (spec.startsWith("workspace:")) {
          if (!names.has(name)) {
            if (root) {
              delete deps[name];
              notices.push(
                `Excluded root-only ${field} dependency ${name}: workspace is not in the publication tree.`,
              );
            } else
              blockers.push(
                `${owner} requires missing workspace ${name}; include that package in the candidate.`,
              );
          }
        } else if (/^(file:|link:|\.\.?\/|\/)/.test(spec)) {
          blockers.push(
            `${owner}: local dependency ${name} requires full-tree validation; this preview does not support file/link protocols.`,
          );
        } else if (spec.includes(":") && !/^npm:[@a-zA-Z0-9_.\/-]+@[^:]+$/.test(spec)) {
          blockers.push(
            `${owner}: dependency protocol for ${name} is not supported by offline registry preview.`,
          );
        }
      }
    }
  };
  check("Root", manifest, true);
  for (const pkg of workspaces) {
    check(pkg.path, pkg.manifest, false);
    if (Object.keys(object(pkg.manifest.scripts)).length)
      notices.push(
        `Review workspace scripts in ${pkg.path}: lifecycle scripts were not executed or certified.`,
      );
  }
  const overrides = input.overrides ?? {};
  for (const field of ["name", "version", "private", "type", "packageManager"] as const) {
    const value = overrides[field];
    if (value !== undefined) manifest[field] = value;
  }
  if (overrides.engines && Object.keys(overrides.engines).length)
    manifest.engines = { ...object(manifest.engines), ...overrides.engines };
  for (const [name, command] of Object.entries(object(manifest.scripts))) {
    if (typeof command !== "string") blockers.push(`Root script ${name} must be a string.`);
    else {
      notices.push(
        `Review root script ${name}: script behavior is not proven by an install with scripts disabled.`,
      );
      for (const match of command.matchAll(
        /(?:^|[\s"'=])((?:packages|apps|scripts|tools)\/[A-Za-z0-9_./@-]+)/g,
      )) {
        const ref = match[1]!;
        if (
          input.publicationPaths &&
          !input.publicationPaths.some((p) => p === ref || p.startsWith(ref + "/"))
        ) {
          delete object(manifest.scripts)[name];
          notices.push(
            `Excluded root script ${name}: it references absent ${ref}. Review this generated exclusion before Freeze.`,
          );
          break;
        }
      }
    }
  }
  // Keep catalogs/overrides intact; Bun, not this adapter, resolves their semantics.
  // Unknown local references (including overrides/exports/bin) cannot be certified here.
  const serialized = JSON.stringify({ manifest, workspaces });
  if (
    /(?:\.private(?:[\/\\]|\b)|\/home\/|\/Users\/|https?:\/\/[^\s"/]*@|(?:_authToken|_password)"\s*:)/i.test(
      serialized,
    )
  )
    blockers.push(
      "Manifest inputs contain private paths or credentials; use the owning disclosure review before preview.",
    );
  return {
    manifest,
    text: JSON.stringify(manifest, null, 2) + "\n",
    blockers,
    notices,
    workspacePaths: workspaces.map((pkg) => pkg.path),
  };
}
