#!/usr/bin/env bun

import { defineCLI, type DefineCLIOptions } from "@reliverse/rempts";

import {
  withGrOwnerPushHost,
  withGrOwnerCommitHost,
  type GrOwnerPushHost,
  type GrOwnerCommitHost,
} from "./owner-push";
import { remptsPackagedProfile } from "./rempts/generated-profile.mjs";

declare const RELIVERSE_GR_VERSION: string | undefined;

const compiledGrVersion =
  typeof RELIVERSE_GR_VERSION === "string" && RELIVERSE_GR_VERSION.length > 0
    ? RELIVERSE_GR_VERSION
    : undefined;

export type RunGrCliOptions = Pick<
  DefineCLIOptions,
  "argv" | "cwd" | "env" | "onError" | "onExit" | "outputMode" | "stderr" | "stdin" | "stdout"
> & {
  readonly entry?: string | undefined;
  readonly profile?: DefineCLIOptions["profile"];
  readonly ownerPushHost?: GrOwnerPushHost;
  readonly ownerCommitHost?: GrOwnerCommitHost;
};

export async function runGrCli(options: RunGrCliOptions = {}) {
  const {
    entry = new URL("./cli.ts", import.meta.url).href,
    ownerPushHost,
    ownerCommitHost,
    ...overrides
  } = options;
  return withGrOwnerCommitHost(ownerCommitHost, () =>
    withGrOwnerPushHost(ownerPushHost, () =>
      defineCLI({
        ...overrides,
        entry,
        artifacts: { enable: true },
        interactionMode: "tty",
        profile: options.profile ?? remptsPackagedProfile,
        name: "gr",
        ...(compiledGrVersion ? { version: compiledGrVersion } : {}),
        description:
          "GR CLI for truthful repository evidence, portable patches, recovery, restore, and isolated snapshot sandboxes. Git is the v0 backend, not the agent workflow API.",
        help: {
          format: "auto",
          examples: [
            "gr status",
            "gr push",
            "gr version",
            "gr campaign plan packages/gr-core apps/cli/gr --id reliverse-open-sourcing-001 --base origin/main",
            "gr hooks status",
            "gr hooks install --apply",
            "gr status --all --json",
            "gr snapshot --role baseline --apply",
            "gr snapshot --accepted-head --role baseline --apply",
            "gr bundle --apply",
            "gr diff <before-snapshot.json> <result-snapshot.json>",
            "gr diff <before-snapshot.json> <result-snapshot.json> --patch",
            "gr patch <before-snapshot.json> <result-snapshot.json> --apply",
            "gr patch finalize <baseline-snapshot.json> --apply",
            "gr recovery <before-snapshot.json> <result-snapshot.json> --apply",
            "gr restore <capsule.json> --direction reverse --apply",
            "gr sandbox materialize <baseline-snapshot.json> --apply",
          ],
        },
      }),
    ),
  );
}

export async function runGrArtifact(entry: ImportMeta, profile: DefineCLIOptions["profile"]) {
  return runGrCli({ entry: entry.url, profile });
}

if (import.meta.main) {
  await runGrCli();
}
