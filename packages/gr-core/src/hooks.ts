import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { runRequiredGrGit } from "./git";
import type { GrEffectKind } from "./model";

export const GR_HOOK_POLICY_SCHEMA_VERSION = "gr.hook-policy.v0" as const;
export const GR_GIT_AUTHORITY_ENV = "RELIVERSE_GR_GIT_AUTHORITY" as const;
export const GR_GIT_AUTHORITY_VALUE = "gr" as const;

const READ_ONLY_GIT_COMMANDS = new Set([
  "blame",
  "cat-file",
  "describe",
  "diff",
  "for-each-ref",
  "grep",
  "log",
  "ls-files",
  "ls-tree",
  "name-rev",
  "rev-list",
  "rev-parse",
  "shortlog",
  "show",
  "show-ref",
  "status",
]);

const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--config-env",
]);

export type GrGitInvocationClassificationV0 = {
  readonly schemaVersion: "gr.git-invocation-classification.v0";
  readonly command: string;
  readonly mutation: boolean;
  readonly authorityRequired: boolean;
  readonly posture: "read-only-allowlisted" | "gr-authority-required";
};

function gitSubcommand(args: readonly string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (GLOBAL_OPTIONS_WITH_VALUE.has(arg)) {
      index += 1;
      continue;
    }
    if ([...GLOBAL_OPTIONS_WITH_VALUE].some((option) => arg.startsWith(`${option}=`))) continue;
    if (arg === "--version" || arg === "--help") return arg;
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return "";
}

export function classifyGrGitInvocation(args: readonly string[]): GrGitInvocationClassificationV0 {
  const command = gitSubcommand(args);
  const readOnly =
    command === "--version" || command === "--help" || READ_ONLY_GIT_COMMANDS.has(command);
  return Object.freeze({
    schemaVersion: "gr.git-invocation-classification.v0",
    command,
    mutation: !readOnly,
    authorityRequired: !readOnly,
    posture: readOnly ? "read-only-allowlisted" : "gr-authority-required",
  });
}

export function assertGrGitInvocationAuthorized(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  const classification = classifyGrGitInvocation(args);
  if (classification.authorityRequired && env[GR_GIT_AUTHORITY_ENV] !== GR_GIT_AUTHORITY_VALUE) {
    throw new GrError(
      "GR_GIT_MUTATION_DENIED",
      `Git ${classification.command || "operation"} must be performed through GR authority.`,
      {
        command: classification.command,
        posture: classification.posture,
      },
    );
  }
}

function hookScript(hook: string): string {
  return `#!/usr/bin/env sh\nset -eu\nif [ "\${${GR_GIT_AUTHORITY_ENV}:-}" = "${GR_GIT_AUTHORITY_VALUE}" ]; then\n  exit 0\nfi\nprintf '%s\\n' 'GR_GIT_MUTATION_DENIED: ${hook} is guarded by GR; use GR instead of direct Git mutation.' >&2\nexit 1\n`;
}

export async function installGrGitAuthorityHooks(options: {
  readonly root: string;
  readonly grantedEffects?: readonly GrEffectKind[] | undefined;
}): Promise<{
  readonly schemaVersion: "gr.hooks-install-receipt.v0";
  readonly operation: "gr.hooks.install";
  readonly hooksPath: string;
  readonly hooks: readonly string[];
  readonly policy: {
    readonly agentGitInvocation: "deny-unless-read-only-or-gr-authorized";
    readonly gitHooks: "defense-in-depth-not-security-boundary";
  };
}> {
  assertGrEffects(
    ["filesystem.read", "filesystem.write", "git.read", "git.write"],
    options.grantedEffects,
  );
  const gitDirectory = (await runRequiredGrGit(options.root, ["rev-parse", "--git-dir"])).trim();
  const resolvedGitDirectory = path.resolve(options.root, gitDirectory);
  const hooksPath = path.join(resolvedGitDirectory, "reliverse-gr-hooks");
  const configuredHooksPath = (
    await runRequiredGrGit(options.root, ["config", "--local", "--get", "core.hooksPath"]).catch(
      () => "",
    )
  ).trim();
  if (configuredHooksPath) {
    const configuredAbsolute = path.isAbsolute(configuredHooksPath)
      ? configuredHooksPath
      : path.resolve(options.root, configuredHooksPath);
    if (path.resolve(configuredAbsolute) !== path.resolve(hooksPath)) {
      throw new GrError(
        "GR_HOOKS_PATH_CONFLICT",
        "GR refuses to replace an existing core.hooksPath without an explicit migration/chaining plan.",
        { configuredHooksPath },
      );
    }
  } else {
    const defaultHooksPath = path.join(resolvedGitDirectory, "hooks");
    const existing = await readdir(defaultHooksPath).catch(() => [] as string[]);
    const customHooks = existing.filter(
      (name) => !name.endsWith(".sample") && !name.startsWith("."),
    );
    if (customHooks.length > 0) {
      throw new GrError(
        "GR_HOOKS_PATH_CONFLICT",
        "GR refuses to shadow existing repository Git hooks without an explicit migration/chaining plan.",
        { hooks: customHooks.sort() },
      );
    }
  }
  await mkdir(hooksPath, { recursive: true });
  const hooks = [
    "pre-commit",
    "pre-merge-commit",
    "pre-push",
    "pre-rebase",
    "reference-transaction",
  ] as const;
  for (const hook of hooks) {
    const file = path.join(hooksPath, hook);
    await writeFile(file, hookScript(hook), "utf8");
    await chmod(file, 0o755);
  }
  await runRequiredGrGit(options.root, ["config", "--local", "core.hooksPath", hooksPath], {
    env: { ...process.env, [GR_GIT_AUTHORITY_ENV]: GR_GIT_AUTHORITY_VALUE },
  });
  return Object.freeze({
    schemaVersion: "gr.hooks-install-receipt.v0",
    operation: "gr.hooks.install",
    hooksPath,
    hooks,
    policy: {
      agentGitInvocation: "deny-unless-read-only-or-gr-authorized" as const,
      gitHooks: "defense-in-depth-not-security-boundary" as const,
    },
  });
}

export async function inspectGrGitAuthorityHooks(root: string): Promise<{
  readonly schemaVersion: "gr.hooks-inspection.v0";
  readonly operation: "gr.hooks.inspect";
  readonly configured: boolean;
  readonly hooksPath?: string | undefined;
  readonly missing: readonly string[];
}> {
  const configuredPath = (
    await runRequiredGrGit(root, ["config", "--local", "--get", "core.hooksPath"]).catch(() => "")
  ).trim();
  if (!configuredPath)
    return Object.freeze({
      schemaVersion: "gr.hooks-inspection.v0",
      operation: "gr.hooks.inspect",
      configured: false,
      missing: [],
    });
  const hooks = [
    "pre-commit",
    "pre-merge-commit",
    "pre-push",
    "pre-rebase",
    "reference-transaction",
  ] as const;
  const resolvedHooksPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(root, configuredPath);
  const missing: string[] = [];
  for (const hook of hooks) {
    try {
      await readFile(path.join(resolvedHooksPath, hook), "utf8");
    } catch {
      missing.push(hook);
    }
  }
  return Object.freeze({
    schemaVersion: "gr.hooks-inspection.v0",
    operation: "gr.hooks.inspect",
    configured: missing.length === 0,
    hooksPath: resolvedHooksPath,
    missing,
  });
}
