import {
  defineContributionPoint,
  definePluginContribution,
  type RemptsOwnedPluginContribution,
  type RemptsPluginContribution,
  type RemptsPluginQueryAPI,
} from "@reliverse/rempts";

import { assertQualitySuiteManifest } from "./contract";
import { QualityError } from "./error";
import { fingerprintJson, stableJsonStringify } from "./json";
import type { QualitySuite, QualitySuiteManifest } from "./model";

export const QUALITY_SUITE_CONTRIBUTION_KIND = "rq.quality-suite" as const;
export const QUALITY_SUITE_CONTRIBUTION_API_VERSION = 0 as const;

function assertQualityContribution(
  contribution: RemptsPluginContribution<QualitySuiteManifest, QualitySuite>,
): void {
  const suite = contribution.runtime;
  if (suite == null || typeof suite !== "object") {
    throw new QualityError(
      "RQ_CONTRACT_INVALID",
      `Quality contribution ${contribution.id} is missing its runtime suite.`,
    );
  }

  assertQualitySuiteManifest(contribution.manifest, Object.keys(suite.checks));
  if (contribution.id !== contribution.manifest.id) {
    throw new QualityError(
      "RQ_CONTRACT_INVALID",
      `Quality contribution id ${contribution.id} must match suite id ${contribution.manifest.id}.`,
    );
  }
  if (stableJsonStringify(contribution.manifest) !== stableJsonStringify(suite.manifest)) {
    throw new QualityError(
      "RQ_CONTRACT_INVALID",
      `Quality contribution ${contribution.id} manifest does not match its runtime suite.`,
    );
  }
  const expectedFingerprint = fingerprintJson(
    contribution.manifest,
    "rq.quality-suite-manifest.v0",
  );
  if (suite.manifestFingerprint !== expectedFingerprint) {
    throw new QualityError(
      "RQ_CONTRACT_INVALID",
      `Quality contribution ${contribution.id} has an invalid manifest fingerprint.`,
    );
  }
}

export const QUALITY_SUITE_CONTRIBUTION_POINT = defineContributionPoint<
  QualitySuiteManifest,
  QualitySuite
>({
  apiVersion: QUALITY_SUITE_CONTRIBUTION_API_VERSION,
  kind: QUALITY_SUITE_CONTRIBUTION_KIND,
  validate: assertQualityContribution,
});

export function defineQualityContribution(
  suite: QualitySuite,
): RemptsPluginContribution<QualitySuiteManifest, QualitySuite> {
  return definePluginContribution(QUALITY_SUITE_CONTRIBUTION_POINT, {
    id: suite.manifest.id,
    manifest: suite.manifest,
    runtime: suite,
  });
}

export function getRemptsQualitySuites(
  plugins: RemptsPluginQueryAPI,
): readonly RemptsOwnedPluginContribution<QualitySuiteManifest, QualitySuite>[] {
  return plugins.getContributions(QUALITY_SUITE_CONTRIBUTION_POINT);
}
