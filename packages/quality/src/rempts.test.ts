import { describe, expect, test } from "bun:test";

import { createRemptsPluginAPI, definePlugin, REMPTS_PLUGIN_API_VERSION } from "@reliverse/rempts";

import { defineQualitySuite } from "./index";
import {
  defineQualityContribution,
  getRemptsQualitySuites,
  QUALITY_SUITE_CONTRIBUTION_POINT,
} from "./rempts";

const entry = import.meta.url;

function createSuite() {
  return defineQualitySuite({
    id: "repo",
    title: "Repository Quality",
    description: "Fixture suite transported through Rempts.",
    capabilities: [],
    rules: [],
    providers: [],
  });
}

describe("quality Rempts integration", () => {
  test("transports one suite through a headless Rempts plugin", () => {
    const suite = createSuite();
    const plugin = definePlugin({
      apiVersion: REMPTS_PLUGIN_API_VERSION,
      entry,
      name: "repo-rq-plugin",
      contributions: [defineQualityContribution(suite)],
    });
    const plugins = createRemptsPluginAPI({
      contributionPoints: [QUALITY_SUITE_CONTRIBUTION_POINT],
      plugins: [plugin],
    });

    const contributions = getRemptsQualitySuites(plugins);
    expect(contributions).toHaveLength(1);
    expect(contributions[0]?.owner.name).toBe("repo-rq-plugin");
    expect(contributions[0]?.contribution.runtime).toBe(suite);
    expect(contributions[0]?.contribution.manifest).toEqual(suite.manifest);
  });

  test("keeps suite identity separate from plugin identity", () => {
    const suite = createSuite();
    const contribution = defineQualityContribution(suite);

    expect(contribution.id).toBe("repo");
    expect(contribution.manifest).not.toHaveProperty("packageName");
    expect(contribution.manifest).not.toHaveProperty("version");
  });
});
