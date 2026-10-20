import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createGrCampaignPlan,
  freezeGrCampaignPlan,
  resolveGrDurablePrivatePath,
  type GrCampaignPlanV0,
} from "@reliverse/gr";
import { defineCommand } from "@reliverse/rempts";

import { grErrorMessage, resolveGrCliRoot, rootOption } from "../../../shared";

export function parseGrCampaignPublicationPolicy(
  value: unknown,
): NonNullable<GrCampaignPlanV0["policy"]["publication"]> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("--publication-policy must contain a source-only policy object");
  const policy = value as Record<string, unknown>;
  if (
    Object.keys(policy).sort().join(",") !== "exceptionRef,installability,mode" ||
    policy.mode !== "source-only" ||
    policy.installability !== "not-claimed" ||
    typeof policy.exceptionRef !== "string" ||
    !policy.exceptionRef.trim() ||
    /[\r\n\0]/.test(policy.exceptionRef)
  )
    throw new Error(
      "--publication-policy requires mode=source-only, installability=not-claimed and an explicit exceptionRef",
    );
  return { mode: "source-only", installability: "not-claimed", exceptionRef: policy.exceptionRef };
}

export default defineCommand({
  meta: {
    name: "plan",
    description:
      "Plan a campaign-scoped public change boundary without requiring the whole workspace to be clean.",
  },
  conventions: { idempotent: true, supportsApply: true },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.read", "fs.write", "process.exec"],
  },
  options: {
    root: rootOption,
    id: {
      type: "string",
      description: "Campaign ID, for example reviewed-source.",
      inputSources: ["flag"],
    },
    base: {
      type: "string",
      description: "Expected public Git base revision.",
      inputSources: ["flag"],
    },
    sourceOnly: {
      type: "boolean",
      default: false,
      inputSources: ["flag"],
      description:
        "Declare source-only planning intent; requires an explicit --publication-policy. Grants no publication authority.",
    },
    publicationPolicy: {
      type: "string",
      description:
        "JSON file with source-only mode, not-claimed installability and an explicit exceptionRef; planning data, not approval.",
      inputSources: ["flag"],
    },
    commits: {
      type: "string",
      description: "Optional JSON file containing campaign commit specs.",
      inputSources: ["flag"],
    },
  },
  help: {
    examples: [
      "gr campaign plan packages/gr-core apps/cli/gr --id reviewed-source --base origin/main",
      "gr campaign plan packages/gr-core apps/cli/gr --id reviewed-source --base HEAD --apply",
    ],
  },
  async handler(ctx) {
    try {
      const id = ctx.cli.options.id;
      const base = ctx.cli.options.base;
      if (!id || !base || ctx.cli.positionals.length === 0) {
        ctx.exit(
          2,
          "Usage: gr campaign plan <paths...> --id <campaign-id> --base <revision> [--root <repository>] [--apply]",
        );
      }
      const policyPath = ctx.cli.options.publicationPolicy;
      if (!!ctx.cli.options.sourceOnly !== !!policyPath)
        throw new Error(
          "--source-only requires --publication-policy <json-file>, and vice versa; neither grants approval.",
        );
      const publication = policyPath
        ? parseGrCampaignPublicationPolicy(
            JSON.parse(await readFile(path.resolve(ctx.cwd, policyPath), "utf8")),
          )
        : undefined;
      const root = await resolveGrCliRoot(ctx.cwd, ctx.cli.options.root);
      const commitsPath = ctx.cli.options.commits;
      const commits = commitsPath
        ? JSON.parse(await readFile(path.resolve(ctx.cwd, commitsPath), "utf8"))
        : undefined;
      if (commits !== undefined && !Array.isArray(commits))
        ctx.exit(2, "--commits must point to a JSON array of commit specs");
      const draft = await createGrCampaignPlan({
        root,
        campaignId: id,
        baseRevision: base,
        paths: ctx.cli.positionals,
        commits,
        ...(publication ? { publication } : {}),
        grantedEffects: ["filesystem.read", "git.read"],
      });
      const plan = commits?.length
        ? await freezeGrCampaignPlan({
            root,
            plan: draft,
            grantedEffects: ["filesystem.read", "git.read", "git.write"],
          })
        : draft;
      if (!ctx.safety.apply) {
        if (ctx.output.mode === "json") ctx.output.result(plan, "gr campaign plan preview");
        else {
          ctx.out(`Campaign: ${plan.campaignId}`);
          ctx.out(`Base: ${plan.base.commit.oid}`);
          ctx.out(`Scope: ${plan.scope.paths.join(", ")}`);
          ctx.out(`Campaign state: ${plan.workspace.cleanliness}`);
          ctx.out(`In scope: ${plan.workspace.inScope.length} changed paths`);
          ctx.out(`Outside scope: ${plan.workspace.outsideScope.length} changed paths`);
          ctx.out("Run with --apply to persist the plan under .private/reliverse/gr/campaigns/.");
        }
        return;
      }
      ctx.safety.assertApplied(
        "fs.write",
        "gr campaign plan requires --apply to persist private campaign state",
      );
      const directory = await resolveGrDurablePrivatePath(root, ["campaigns", plan.campaignId]);
      const artifact = path.join(directory, "plan.json");
      await mkdir(directory, { recursive: true });
      await writeFile(artifact, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
      const result = Object.freeze({
        schemaVersion: "gr.campaign-plan-materialization.v0",
        plan,
        artifact,
      });
      if (ctx.output.mode === "json") ctx.output.result(result, "gr campaign plan");
      else {
        ctx.out(`Campaign: ${plan.campaignId}`);
        ctx.out(`State: ${plan.workspace.cleanliness}`);
        ctx.out(`Plan: ${artifact}`);
        ctx.out(`Fingerprint: ${plan.campaignFingerprint}`);
      }
    } catch (error) {
      ctx.exit(1, grErrorMessage(error));
    }
  },
});
