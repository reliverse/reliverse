import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REPO_RQ_CONFIG_DEFAULTS } from "../config";
import { inspectSpecsPolicy } from "./policy";

async function withRepository(
  files: Readonly<Record<string, string>>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "rq-specs-"));
  try {
    await writeFile(
      join(root, "package.json"),
      '{"name":"fixture","private":true,"workspaces":["packages/*"]}\n',
    );
    for (const [relativePath, source] of Object.entries(files)) {
      const target = join(root, relativePath);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, source);
    }
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

describe("Rse Specs adoption policy", () => {
  test("reports versioned, duplicate, oversized, and historical living specs", async () => {
    await withRepository(
      {
        "docs/specs/gateway-v0.md": "# Gateway v0\n\nStage 82\n",
        "docs/specs/runtime-2.md": "# Runtime\n\n" + "line\n".repeat(5),
      },
      async (root) => {
        const report = await inspectSpecsPolicy(root, {
          ...REPO_RQ_CONFIG_DEFAULTS.specs,
          adoptionMode: "guided",
          maxLines: 4,
        });
        expect(report.findings.map((finding) => finding.ruleId)).toEqual([
          "repo.specs.historical-artifact",
          "repo.specs.versioned-living-spec",
          "repo.specs.duplicate-generation",
          "repo.specs.oversized-file",
        ]);
        expect(report.findings.every((finding) => finding.severity === "warning")).toBe(true);
      },
    );
  });

  test("observe mode downgrades adoption debt to info", async () => {
    await withRepository({ "docs/specs/gateway-v0.md": "# Gateway v0\n" }, async (root) => {
      const report = await inspectSpecsPolicy(root, {
        ...REPO_RQ_CONFIG_DEFAULTS.specs,
        adoptionMode: "observe",
        versionedLivingSeverity: "error",
      });
      expect(report.findings).toHaveLength(1);
      expect(report.findings[0]?.severity).toBe("info");
    });
  });

  test("supports ignored migration and example paths", async () => {
    await withRepository(
      { "docs/specs/examples/gateway-v0.md": "# Gateway v0\n" },
      async (root) => {
        const report = await inspectSpecsPolicy(root, {
          ...REPO_RQ_CONFIG_DEFAULTS.specs,
          ignore: ["docs/specs/examples/**"],
        });
        expect(report.findings).toHaveLength(0);
      },
    );
  });
});

test("enforces configured generated manifests and canonical metadata", async () => {
  await withRepository(
    {
      "docs/specs/rse/foundation/system.md": `---
kind: spec
status: candidate
authority: normative
implementation: planned
authorship:
  mode: human-directed-ai-authored
  model: gpt-5.6-sol
  reasoning: high
  confidence: exact
review:
  human: pending
  conceptualDiscussion: completed
---

# System
`,
    },
    async (root) => {
      const { defineSpecAdoption, writeSpecManifest } = await import("@reliverse/spec");
      const specConfig = defineSpecAdoption({
        id: "fixture",
        roots: ["docs/specs/rse"],
        manifestPath: "docs/specs/rse/manifest.json",
        privateRoot: ".private/reliverse/rse/plugins/spec/adoption",
        classification: [
          { class: "canonical", glob: "docs/specs/rse/foundation/**" },
          { class: "legacy-input", glob: "docs/specs/rse/**" },
        ],
      });
      await writeSpecManifest(root, specConfig);
      const current = await inspectSpecsPolicy(root, {
        ...REPO_RQ_CONFIG_DEFAULTS.specs,
        adoptionMode: "guided",
        requiredManifests: ["docs/specs/rse/manifest.json"],
      });
      expect(current.findings).toEqual([]);

      await writeFile(
        join(root, "docs/specs/rse/foundation/system.md"),
        "# Changed without regenerating manifest\n",
      );
      const drifted = await inspectSpecsPolicy(root, {
        ...REPO_RQ_CONFIG_DEFAULTS.specs,
        adoptionMode: "guided",
        requiredManifests: ["docs/specs/rse/manifest.json"],
      });
      expect(drifted.findings.map((finding) => finding.ruleId)).toEqual([
        "repo.specs.manifest-drift",
      ]);
      expect(drifted.findings[0]?.severity).toBe("error");
    },
  );
});

test("reports incomplete canonical metadata from a current manifest", async () => {
  await withRepository({ "docs/specs/rse/foundation/system.md": "# System\n" }, async (root) => {
    const { defineSpecAdoption, writeSpecManifest } = await import("@reliverse/spec");
    const specConfig = defineSpecAdoption({
      id: "fixture-metadata",
      roots: ["docs/specs/rse"],
      manifestPath: "docs/specs/rse/manifest.json",
      privateRoot: ".private/reliverse/rse/plugins/spec/adoption",
      classification: [
        { class: "canonical", glob: "docs/specs/rse/foundation/**" },
        { class: "legacy-input", glob: "docs/specs/rse/**" },
      ],
    });
    await writeSpecManifest(root, specConfig);
    const report = await inspectSpecsPolicy(root, {
      ...REPO_RQ_CONFIG_DEFAULTS.specs,
      requiredManifests: ["docs/specs/rse/manifest.json"],
    });
    expect(report.findings.map((finding) => finding.ruleId)).toEqual([
      "repo.specs.canonical-metadata",
    ]);
    expect(report.findings[0]?.severity).toBe("error");
  });
});
