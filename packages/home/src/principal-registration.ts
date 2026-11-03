import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { ReliversePrincipalV0 } from "./model";
import { isOpaquePrincipalDirectoryName, resolveReliverseHomeRoot } from "./paths";
import {
  createReliversePrincipal,
  normalizePrincipalHandle,
  validateReliversePrincipal,
} from "./principal";
import { inspectReliverseHome } from "./runtime";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const reject = (reason: string) => new Error(`RELIVERSE_PRINCIPAL_REGISTRATION_${reason}`);
const lockName = ".registration.lock";

async function withRegistryLock<T>(root: string, run: () => Promise<T>): Promise<T> {
  await directory(root);
  const registry = path.join(root, "principals");
  await directory(registry);
  const lock = path.join(registry, lockName);
  await mkdir(lock, { mode: 0o700 });
  try {
    return await run();
  } finally {
    await rmdir(lock);
  }
}

export interface ReliversePrincipalRegistrationPlan {
  readonly format: "reliverse.principal-registration-plan.v0";
  readonly root: string;
  readonly stateFingerprint: string;
  readonly principal: ReliversePrincipalV0;
  readonly planFingerprint: string;
}

async function directory(target: string) {
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(target)) !== target)
    throw reject("PATH_UNSAFE");
}
async function regular(target: string) {
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw reject("PATH_UNSAFE");
  return readFile(target, "utf8");
}

async function state(root: string, locked = false) {
  await directory(root);
  const registry = path.join(root, "principals");
  await directory(registry);
  const manifest = await regular(path.join(root, "home.json"));
  const inspection = await inspectReliverseHome(root);
  if (!inspection.ok || !inspection.manifest || !inspection.principal) throw reject("HOME_INVALID");

  const records: { id: string; content: string; principal: ReliversePrincipalV0 }[] = [];
  for (const name of (await readdir(registry)).sort()) {
    if (name === lockName && locked) continue;
    if (name === lockName) throw reject("LOCKED");
    if (!isOpaquePrincipalDirectoryName(name)) throw reject("REGISTRY_INVALID");
    await directory(path.join(registry, name));
    const content = await regular(path.join(registry, name, "principal.json"));
    const principal = JSON.parse(content) as ReliversePrincipalV0;
    if (validateReliversePrincipal(principal).length || principal.id !== name)
      throw reject("REGISTRY_INVALID");
    records.push({ id: name, content, principal });
  }
  return {
    registry,
    manifest,
    defaultPrincipalId: inspection.manifest.defaultPrincipalId,
    fingerprint: digest({ manifest, records: records.map(({ id, content }) => ({ id, content })) }),
    records,
  };
}

function assertAvailable(
  current: Awaited<ReturnType<typeof state>>,
  principal: ReliversePrincipalV0,
) {
  if (validateReliversePrincipal(principal).length || principal.status !== "active")
    throw reject("PRINCIPAL_INVALID");
  if (
    current.records.some(
      ({ principal: existing }) =>
        existing.id === principal.id ||
        existing.handle === principal.handle ||
        existing.aliases?.some(
          (alias) => alias.namespace === "local-handle" && alias.value === principal.handle,
        ),
    )
  ) {
    throw reject("CONFLICT");
  }
}

/** Metadata only: a local Principal record does not authenticate a runtime or enroll a signing key. */
export async function planReliversePrincipalRegistration(
  input: Parameters<typeof createReliversePrincipal>[0] & { readonly root?: string },
): Promise<ReliversePrincipalRegistrationPlan> {
  const root = resolveReliverseHomeRoot({ override: input.root });
  const current = await state(root);
  const principal = createReliversePrincipal(input);
  assertAvailable(current, principal);
  const plan = {
    format: "reliverse.principal-registration-plan.v0" as const,
    root,
    stateFingerprint: current.fingerprint,
    principal,
  };
  return Object.freeze({ ...plan, planFingerprint: digest(plan) });
}

/** Cooperative create-only Home write, not a protected admission/authorization boundary.
 * An interrupted lock or partially published identity is retained, never stolen or overwritten. */
export async function applyReliversePrincipalRegistration(
  input: ReliversePrincipalRegistrationPlan,
) {
  const plan = structuredClone(input);
  const { planFingerprint, ...unsigned } = plan;
  if (
    plan.format !== "reliverse.principal-registration-plan.v0" ||
    digest(unsigned) !== planFingerprint ||
    resolveReliverseHomeRoot({ override: plan.root }) !== plan.root
  )
    throw reject("PLAN_INVALID");
  return withRegistryLock(plan.root, async () => {
    const registry = path.join(plan.root, "principals");
    let published = false;
    let attempted = false;
    try {
      const current = await state(plan.root, true);
      if (current.fingerprint !== plan.stateFingerprint) throw reject("STALE");
      assertAvailable(current, plan.principal);
      const target = path.join(registry, plan.principal.id);
      // An existing partial directory is a recovery boundary, not an idempotent retry.
      await mkdir(target, { mode: 0o700 });
      const pending = path.join(target, `.principal-${randomUUID()}.pending`);
      const destination = path.join(target, "principal.json");
      const content = `${JSON.stringify(plan.principal, null, 2)}\n`;
      attempted = true;
      await writeFile(pending, content, { flag: "wx", mode: 0o600 });
      await link(pending, destination);
      published = true;
      await unlink(pending);
      if ((await regular(destination)) !== content) throw reject("READBACK_FAILED");
      const after = await state(plan.root, true);
      const previous = after.records.filter((record) => record.id !== plan.principal.id);
      if (
        digest({
          manifest: after.manifest,
          records: previous.map(({ id, content }) => ({ id, content })),
        }) !== plan.stateFingerprint
      ) {
        throw reject("READBACK_FAILED");
      }
      return Object.freeze({
        format: "reliverse.principal-registration-result.v0" as const,
        principal: plan.principal,
        path: destination,
        defaultPrincipalId: current.defaultPrincipalId,
        authenticated: false as const,
        credentialCreated: false as const,
        authorityGranted: false as const,
      });
    } catch (error) {
      if (attempted || published) throw reject("OUTCOME_UNCERTAIN");
      throw error;
    }
  });
}

export interface ReliversePrincipalRenamePlan {
  readonly format: "reliverse.principal-rename-plan.v0";
  readonly root: string;
  readonly stateFingerprint: string;
  readonly before: ReliversePrincipalV0;
  readonly principal: ReliversePrincipalV0;
  readonly planFingerprint: string;
}

function renamedPrincipal(before: ReliversePrincipalV0, handle: string, displayName: string) {
  const normalized = normalizePrincipalHandle(handle);
  if (!displayName.trim() || before.status !== "active") throw reject("PRINCIPAL_INVALID");
  return {
    ...before,
    handle: normalized,
    displayName: displayName.trim(),
    aliases: [
      ...before.aliases.filter((alias) => alias.namespace !== "local-handle"),
      { namespace: "local-handle", value: normalized, verified: true },
    ],
  };
}

/** Rename display metadata without replacing identity, lifecycle or nonlocal aliases. */
export async function planReliversePrincipalRename(input: {
  readonly root?: string;
  readonly principalId: string;
  readonly handle: string;
  readonly displayName: string;
}): Promise<ReliversePrincipalRenamePlan> {
  const root = resolveReliverseHomeRoot({ override: input.root });
  const current = await state(root);
  const before = current.records.find((record) => record.id === input.principalId)?.principal;
  if (!before) throw reject("PRINCIPAL_MISSING");
  const principal = renamedPrincipal(before, input.handle, input.displayName);
  assertAvailable(
    { ...current, records: current.records.filter((record) => record.id !== before.id) },
    principal,
  );
  if (digest(before) === digest(principal)) throw reject("NO_CHANGE");
  const plan = {
    format: "reliverse.principal-rename-plan.v0" as const,
    root,
    stateFingerprint: current.fingerprint,
    before,
    principal,
  };
  return Object.freeze({ ...plan, planFingerprint: digest(plan) });
}

export async function applyReliversePrincipalRename(input: ReliversePrincipalRenamePlan) {
  const plan = structuredClone(input);
  const { planFingerprint, ...unsigned } = plan;
  if (
    plan.format !== "reliverse.principal-rename-plan.v0" ||
    digest(unsigned) !== planFingerprint ||
    resolveReliverseHomeRoot({ override: plan.root }) !== plan.root ||
    digest(
      renamedPrincipal(plan.before, plan.principal.handle, plan.principal.displayName ?? ""),
    ) !== digest(plan.principal)
  )
    throw reject("PLAN_INVALID");
  return withRegistryLock(plan.root, async () => {
    const current = await state(plan.root, true);
    const existing = current.records.find((record) => record.id === plan.before.id);
    if (
      current.fingerprint !== plan.stateFingerprint ||
      !existing ||
      digest(existing.principal) !== digest(plan.before)
    )
      throw reject("STALE");
    assertAvailable(
      { ...current, records: current.records.filter((record) => record.id !== plan.before.id) },
      plan.principal,
    );
    const destination = path.join(current.registry, plan.before.id, "principal.json");
    const pending = path.join(current.registry, plan.before.id, `.rename-${randomUUID()}.pending`);
    const content = `${JSON.stringify(plan.principal, null, 2)}\n`;
    let attempted = false;
    try {
      await writeFile(pending, content, { flag: "wx", mode: 0o600 });
      if ((await state(plan.root, true)).fingerprint !== plan.stateFingerprint)
        throw reject("STALE");
      attempted = true;
      await rename(pending, destination);
      if ((await regular(destination)) !== content) throw reject("READBACK_FAILED");
      const after = await state(plan.root, true);
      const original = after.records.map((record) =>
        record.id === plan.before.id
          ? current.records.find((old) => old.id === record.id)!
          : record,
      );
      if (
        digest({
          manifest: after.manifest,
          records: original.map(({ id, content }) => ({ id, content })),
        }) !== plan.stateFingerprint
      )
        throw reject("READBACK_FAILED");
      return {
        format: "reliverse.principal-rename-result.v0" as const,
        before: plan.before,
        principal: plan.principal,
        path: destination,
        defaultPrincipalId: after.defaultPrincipalId,
        authenticated: false as const,
        credentialCreated: false as const,
        authorityGranted: false as const,
      };
    } catch (error) {
      if (attempted) throw reject("OUTCOME_UNCERTAIN");
      throw error;
    }
  });
}
