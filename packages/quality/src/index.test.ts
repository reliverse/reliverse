import { describe, expect, test } from "bun:test";

import {
  assertQualityPlanHandlerResult,
  createQualityRegistry,
  defineQualitySuite,
  explainQualityIdentifier,
  fingerprintJson,
  normalizeJson,
  QualityError,
  runQualityCheck,
  runQualityPlan,
  stableJsonStringify,
  type QualitySuiteDefinition,
} from "./index";

function createFixtureSuite(overrides: Partial<QualitySuiteDefinition> = {}) {
  return defineQualitySuite({
    id: "repo",
    title: "Repository Quality",
    description: "Synthetic repository quality suite used by the quality kernel tests.",
    capabilities: [
      {
        id: "repo.naming",
        title: "Package naming",
        description: "Checks package identities.",
        operations: ["check", "explain", "plan"],
        defaultProvider: "repo.naming.builtin",
        providers: ["repo.naming.builtin"],
        effects: [
          {
            kind: "filesystem.read",
            reason: "Read package manifests.",
            operations: ["check", "plan"],
          },
        ],
      },
    ],
    rules: [
      {
        id: "repo.naming.duplicate-token",
        diagnosticId: "RQ-REPO-NAMING-DUPLICATE-TOKEN",
        capabilityId: "repo.naming",
        title: "Duplicate naming token",
        description: "Package identity repeats a semantic token.",
        explanation: "A family, binding, role, or variant should appear only when it adds meaning.",
        defaultSeverity: "warning",
        remediation: { kind: "plan", summary: "Remove the redundant token." },
      },
      {
        id: "repo.naming.legacy-pattern",
        diagnosticId: "RQ-REPO-NAMING-LEGACY-PATTERN",
        capabilityId: "repo.naming",
        title: "Legacy extension name",
        description: "Package identity uses the former surface-first extension convention.",
        explanation: "Extension package identities are moving to family-first naming.",
        defaultSeverity: "info",
      },
    ],
    providers: [
      {
        id: "repo.naming.builtin",
        capabilityId: "repo.naming",
        title: "Built-in naming engine",
        version: "0.0.1",
        operations: ["check", "plan"],
        determinism: "deterministic",
        effects: [
          {
            kind: "filesystem.read",
            reason: "Read package manifests.",
            operations: ["check", "plan"],
          },
        ],
      },
    ],
    checks: {
      "repo.naming": ({ input }) => {
        const names = Array.isArray(input)
          ? input.filter((entry): entry is string => typeof entry === "string")
          : [];
        return {
          diagnostics: names.flatMap((name) => {
            if (name.includes("rse-rse")) {
              return [
                {
                  ruleId: "repo.naming.duplicate-token",
                  message: `Duplicate token in ${name}.`,
                  path: "package.json",
                  data: { name },
                },
              ];
            }
            if (name.includes("plugin-rse-")) {
              return [
                {
                  ruleId: "repo.naming.legacy-pattern",
                  message: `Legacy name ${name}.`,
                  path: "package.json",
                  data: { name },
                },
              ];
            }
            return [];
          }),
          metadata: { inspected: names.length },
        };
      },
    },
    plans: {
      "repo.naming": () => {
        const fileFingerprint = fingerprintJson("fixture manifest", "rq.file-content.v0");
        return {
          targetContent: {
            kind: "content",
            fingerprint: fingerprintJson("fixture target", "rq.target-content.v0"),
            description: "Synthetic content evidence, not a VCS snapshot.",
          },
          operations: [
            {
              id: "rename-package-001",
              kind: "write-json",
              path: "packages/example/package.json",
              pointer: "/name",
              before: "@reliverse/plugin-rse-example",
              after: "@reliverse/example-rse-plugin",
              fileFingerprint,
            },
          ],
          preconditions: [
            {
              id: "rename-package-001-file",
              kind: "file-fingerprint",
              path: "packages/example/package.json",
              expected: fileFingerprint,
            },
            {
              id: "rename-package-001-name",
              kind: "json-value",
              path: "packages/example/package.json",
              pointer: "/name",
              expected: "@reliverse/plugin-rse-example",
            },
          ],
          risks: [],
          verification: [
            {
              id: "verify-naming",
              kind: "quality-check",
              capabilityId: "repo.naming",
              description: "Re-run naming policy.",
            },
          ],
          applicable: true,
        };
      },
    },
    ...overrides,
  });
}

const target = {
  kind: "repository",
  id: "fixture",
  root: "/repo",
  snapshot: "tree-1",
} as const;

const planRequest = {
  capabilityId: "repo.naming",
  producer: { pluginId: "repo-rq-plugin", packageName: "@reliverse/repo-rq-plugin" },
  target,
  input: ["@reliverse/plugin-rse-example"],
  grantedEffects: ["filesystem.read"],
} as const;

describe("quality JSON and fingerprints", () => {
  test("canonicalizes object keys and fingerprints equivalent JSON", () => {
    expect(stableJsonStringify({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    expect(fingerprintJson({ b: 2, a: 1 })).toBe(fingerprintJson({ a: 1, b: 2 }));
  });

  test("rejects unsupported, non-finite, undefined, and circular values", () => {
    expect(() => normalizeJson({ value: undefined })).toThrow("Undefined JSON property");
    expect(() => normalizeJson(Number.NaN)).toThrow("finite JSON number");
    expect(() => normalizeJson(new Date())).toThrow("plain JSON object");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => normalizeJson(circular)).toThrow("Circular JSON value");
  });
});

describe("quality suite contract", () => {
  test("creates a stable serializable manifest without package identity", () => {
    const first = createFixtureSuite();
    const second = createFixtureSuite();
    expect(first.manifestFingerprint).toBe(second.manifestFingerprint);
    expect(JSON.parse(JSON.stringify(first.manifest))).toEqual(first.manifest);
    expect(first.manifest).not.toHaveProperty("packageName");
    expect(first.manifest).not.toHaveProperty("version");
  });

  test("rejects duplicate ids and write effects assigned to check", () => {
    expect(() =>
      createFixtureSuite({
        rules: [
          {
            id: "repo.naming.same",
            diagnosticId: "RQ-REPO-NAMING-SAME",
            capabilityId: "repo.naming",
            title: "Same",
            description: "Same",
            explanation: "Same",
            defaultSeverity: "error",
          },
          {
            id: "repo.naming.same",
            diagnosticId: "RQ-REPO-NAMING-OTHER",
            capabilityId: "repo.naming",
            title: "Same",
            description: "Same",
            explanation: "Same",
            defaultSeverity: "error",
          },
        ],
      }),
    ).toThrow("Rule ids must be unique");

    expect(() =>
      createFixtureSuite({
        capabilities: [
          {
            id: "repo.naming",
            title: "Package naming",
            description: "Checks package identities.",
            operations: ["check"],
            effects: [
              {
                kind: "filesystem.write",
                reason: "Unsafe check effect.",
                operations: ["check"],
              },
            ],
          },
        ],
        providers: [],
      }),
    ).toThrow(QualityError);
  });
});

describe("read-only quality checks", () => {
  test("requires declared effect grants", async () => {
    const suite = createFixtureSuite();
    await expect(
      runQualityCheck(suite, {
        capabilityId: "repo.naming",
        target,
        input: [],
      }),
    ).rejects.toMatchObject({ code: "RQ_EFFECT_NOT_GRANTED" });
  });

  test("normalizes, orders, summarizes, and fingerprints diagnostics", async () => {
    const suite = createFixtureSuite();
    const request = {
      capabilityId: "repo.naming",
      target,
      input: ["@reliverse/plugin-rse-dler", "@reliverse/rse-rse-plugin"],
      grantedEffects: ["filesystem.read"],
    } as const;
    const first = await runQualityCheck(suite, request);
    const second = await runQualityCheck(suite, request);

    expect(first).toEqual(second);
    expect(first.suite).toEqual({
      id: "repo",
      manifestFingerprint: suite.manifestFingerprint,
    });
    expect(first.provider).toEqual({ id: "repo.naming.builtin", version: "0.0.1" });
    expect(first.summary).toEqual({ total: 2, error: 0, warning: 1, info: 1 });
    expect(first.diagnostics.map((entry) => entry.ruleId)).toEqual([
      "repo.naming.duplicate-token",
      "repo.naming.legacy-pattern",
    ]);
    expect(first.diagnostics.every((entry) => entry.fingerprint.length === 64)).toBe(true);
    expect(first.resultFingerprint).toHaveLength(64);
    expect(first.metadata).toEqual({ inspected: 2 });
  });

  test("keeps target roots and supplemental evidence outside result fingerprints", async () => {
    let sequence = 0;
    const suite = createFixtureSuite({
      checks: {
        "repo.naming": () => ({
          diagnostics: [
            {
              ruleId: "repo.naming.legacy-pattern",
              message: "Stable failure.",
              path: "package.json",
            },
          ],
          execution: { cwd: `/temporary/root-${sequence}`, durationMs: sequence },
          metadata: { observedAt: (sequence += 1) },
        }),
      },
    });
    const first = await runQualityCheck(suite, {
      capabilityId: "repo.naming",
      target: { ...target, root: "/temporary/first" },
      grantedEffects: ["filesystem.read"],
    });
    const second = await runQualityCheck(suite, {
      capabilityId: "repo.naming",
      target: { ...target, root: "/temporary/second" },
      grantedEffects: ["filesystem.read"],
    });

    expect(first.resultFingerprint).toBe(second.resultFingerprint);
    expect(first.diagnostics[0]?.fingerprint).toBe(second.diagnostics[0]?.fingerprint);
    expect(first.execution).not.toEqual(second.execution);
    expect(first.metadata).not.toEqual(second.metadata);
  });

  test("requires explicit provider selection when no default exists", async () => {
    const suite = createFixtureSuite({
      capabilities: [
        {
          id: "repo.naming",
          title: "Package naming",
          description: "Checks package identities.",
          operations: ["check"],
          providers: ["repo.naming.first", "repo.naming.second"],
        },
      ],
      plans: {},
      providers: [
        {
          id: "repo.naming.first",
          capabilityId: "repo.naming",
          title: "First provider",
          version: "0.0.1",
          operations: ["check"],
          determinism: "deterministic",
        },
        {
          id: "repo.naming.second",
          capabilityId: "repo.naming",
          title: "Second provider",
          version: "0.0.1",
          operations: ["check"],
          determinism: "deterministic",
        },
      ],
    });
    await expect(
      runQualityCheck(suite, {
        capabilityId: "repo.naming",
        target,
        input: [],
      }),
    ).rejects.toMatchObject({ code: "RQ_PROVIDER_AMBIGUOUS" });
    const result = await runQualityCheck(suite, {
      capabilityId: "repo.naming",
      target,
      providerId: "repo.naming.second",
      input: [],
    });
    expect(result.provider?.id).toBe("repo.naming.second");
  });

  test("rejects unknown rules and duplicate diagnostic occurrences", async () => {
    const unknown = createFixtureSuite({
      checks: {
        "repo.naming": () => [{ ruleId: "repo.naming.unknown", message: "Unknown." }],
      },
    });
    await expect(
      runQualityCheck(unknown, {
        capabilityId: "repo.naming",
        target,
        grantedEffects: ["filesystem.read"],
      }),
    ).rejects.toMatchObject({ code: "RQ_RULE_NOT_FOUND" });

    const duplicate = createFixtureSuite({
      checks: {
        "repo.naming": () => [
          {
            ruleId: "repo.naming.legacy-pattern",
            message: "Same.",
            path: "package.json",
          },
          {
            ruleId: "repo.naming.legacy-pattern",
            message: "Same.",
            path: "package.json",
          },
        ],
      },
    });
    await expect(
      runQualityCheck(duplicate, {
        capabilityId: "repo.naming",
        target,
        grantedEffects: ["filesystem.read"],
      }),
    ).rejects.toMatchObject({
      code: "RQ_DIAGNOSTIC_DUPLICATE",
      details: {
        ruleId: "repo.naming.legacy-pattern",
        path: "package.json",
        firstIndex: 0,
        duplicateIndex: 1,
      },
    });
  });
});

describe("deterministic quality plans", () => {
  test("requires plan effects and produces a stable semantic plan", async () => {
    const suite = createFixtureSuite();
    await expect(
      runQualityPlan(suite, { ...planRequest, grantedEffects: [] }),
    ).rejects.toMatchObject({ code: "RQ_EFFECT_NOT_GRANTED" });

    const first = await runQualityPlan(suite, planRequest);
    const second = await runQualityPlan(suite, planRequest);
    expect(first).toEqual(second);
    expect(first.plan.schemaVersion).toBe("rq.change-plan.v0");
    expect(first.plan.planId).toBe(`rq-plan-${first.plan.planFingerprint.slice(0, 20)}`);
    expect(first.plan.operations).toHaveLength(1);
    expect(first.plan.applicable).toBe(true);
  });

  test("keeps non-semantic creation metadata outside the plan fingerprint", async () => {
    const base = createFixtureSuite();
    let sequence = 0;
    const suite = createFixtureSuite({
      plans: {
        "repo.naming": async (context) => ({
          ...(await base.plans["repo.naming"]!(context)),
          metadata: { createdAt: `time-${(sequence += 1)}` },
        }),
      },
    });
    const first = await runQualityPlan(suite, planRequest);
    const second = await runQualityPlan(suite, planRequest);
    expect(first.plan.planFingerprint).toBe(second.plan.planFingerprint);
    expect(first.plan.planId).toBe(second.plan.planId);
    expect(first.resultFingerprint).not.toBe(second.resultFingerprint);
  });

  test("normalizes operation order and rejects unsafe or ambiguous drafts", async () => {
    const fingerprint = fingerprintJson("fixture", "rq.file-content.v0");
    const base = createFixtureSuite();
    const reversed = createFixtureSuite({
      plans: {
        "repo.naming": async (context) => {
          const draft = await base.plans["repo.naming"]!(context);
          const second = {
            id: "rename-package-002",
            kind: "write-json" as const,
            path: "packages/a/package.json",
            pointer: "/name",
            before: "@reliverse/plugin-rse-a",
            after: "@reliverse/a-rse-plugin",
            fileFingerprint: fingerprint,
          };
          return {
            ...draft,
            operations: [draft.operations[0]!, second],
            preconditions: [
              ...draft.preconditions,
              {
                id: "rename-package-002-file",
                kind: "file-fingerprint" as const,
                path: second.path,
                expected: fingerprint,
              },
              {
                id: "rename-package-002-name",
                kind: "json-value" as const,
                path: second.path,
                pointer: "/name",
                expected: second.before,
              },
            ],
          };
        },
      },
    });
    const result = await runQualityPlan(reversed, planRequest);
    expect(
      result.plan.operations.map((entry) => ("path" in entry ? entry.path : entry.from)),
    ).toEqual(["packages/a/package.json", "packages/example/package.json"]);

    expect(() =>
      assertQualityPlanHandlerResult({
        targetContent: { kind: "content", fingerprint, description: "Content evidence." },
        operations: [
          {
            id: "unsafe-operation",
            kind: "delete-path",
            path: "../outside",
            beforeFingerprint: fingerprint,
          },
        ],
        preconditions: [
          {
            id: "unsafe-file",
            kind: "file-fingerprint",
            path: "../outside",
            expected: fingerprint,
          },
        ],
        risks: [],
        verification: [],
        applicable: true,
      }),
    ).toThrow("repository-relative path");

    expect(() =>
      assertQualityPlanHandlerResult({
        targetContent: { kind: "content", fingerprint, description: "Content evidence." },
        operations: [
          {
            id: "missing-evidence",
            kind: "delete-path",
            path: "packages/example/package.json",
            beforeFingerprint: fingerprint,
          },
        ],
        preconditions: [],
        risks: [],
        verification: [],
        applicable: true,
      }),
    ).toThrow("lacks its file-fingerprint precondition");

    expect(() =>
      assertQualityPlanHandlerResult({
        targetContent: { kind: "content", fingerprint, description: "Content evidence." },
        operations: [
          {
            id: "duplicate-write-001",
            kind: "write-json",
            path: "packages/example/package.json",
            pointer: "/name",
            before: "old",
            after: "new-a",
            fileFingerprint: fingerprint,
          },
          {
            id: "duplicate-write-002",
            kind: "write-json",
            path: "packages/example/package.json",
            pointer: "/name",
            before: "old",
            after: "new-b",
            fileFingerprint: fingerprint,
          },
        ],
        preconditions: [
          {
            id: "duplicate-file",
            kind: "file-fingerprint",
            path: "packages/example/package.json",
            expected: fingerprint,
          },
          {
            id: "duplicate-name",
            kind: "json-value",
            path: "packages/example/package.json",
            pointer: "/name",
            expected: "old",
          },
        ],
        risks: [],
        verification: [],
        applicable: true,
      }),
    ).toThrow("duplicate or ambiguous operations");
  });

  test("rejects target mutation effects assigned to planning", () => {
    expect(() =>
      createFixtureSuite({
        capabilities: [
          {
            id: "repo.naming",
            title: "Package naming",
            description: "Plans package identities.",
            operations: ["plan"],
            effects: [
              { kind: "filesystem.write", reason: "Unsafe target write.", operations: ["plan"] },
            ],
          },
        ],
        providers: [],
        checks: {},
      }),
    ).toThrow("planning must not mutate the target");
  });
});

describe("quality registry and explanations", () => {
  test("routes checks by capability and resolves explanations", async () => {
    const suite = createFixtureSuite();
    const registry = createQualityRegistry([suite]);
    expect(registry.capabilities).toEqual(["repo.naming"]);
    expect(registry.getCapabilityOwner("repo.naming")).toBe(suite);
    expect(registry.getSuite("repo")).toBe(suite);
    const result = await registry.check({
      capabilityId: "repo.naming",
      target,
      input: ["@reliverse/plugin-rse-dler"],
      grantedEffects: ["filesystem.read"],
    });
    expect(result.summary.total).toBe(1);
    const plan = await registry.plan(planRequest);
    expect(plan.plan.capabilityId).toBe("repo.naming");
    expect(registry.explain("RQ-REPO-NAMING-LEGACY-PATTERN").kind).toBe("diagnostic");
    expect(explainQualityIdentifier(suite, "repo.naming.legacy-pattern").kind).toBe("rule");
  });

  test("rejects suite and capability collisions", () => {
    const first = createFixtureSuite();
    const second = defineQualitySuite({
      id: "other",
      title: "Other quality suite",
      description: "Synthetic suite that collides on repo.naming.",
      capabilities: first.manifest.capabilities,
      rules: first.manifest.rules,
      providers: first.manifest.providers,
      checks: first.checks,
    });
    expect(() => createQualityRegistry([first, second])).toThrow("more than one owner");
    expect(() => createQualityRegistry([first, first])).toThrow("suite identity collision");

    const duplicateRule = defineQualitySuite({
      id: "duplicate-rule",
      title: "Duplicate rule suite",
      description: "Synthetic suite that collides on a rule id.",
      capabilities: [
        {
          id: "repo.other",
          title: "Other capability",
          description: "Synthetic capability.",
          operations: ["check"],
        },
      ],
      rules: [
        {
          id: first.manifest.rules[0]!.id,
          diagnosticId: "RQ-REPO-OTHER-DUPLICATE-RULE",
          capabilityId: "repo.other",
          title: "Duplicate rule",
          description: "Synthetic duplicate rule.",
          explanation: "Used to verify registry collisions.",
          defaultSeverity: "error",
        },
      ],
      providers: [],
    });
    expect(() => createQualityRegistry([first, duplicateRule])).toThrow(
      `Rule ${first.manifest.rules[0]!.id} has more than one owner`,
    );

    const duplicateDiagnostic = defineQualitySuite({
      id: "duplicate-diagnostic",
      title: "Duplicate diagnostic suite",
      description: "Synthetic suite that collides on a diagnostic id.",
      capabilities: [
        {
          id: "repo.another",
          title: "Another capability",
          description: "Synthetic capability.",
          operations: ["check"],
        },
      ],
      rules: [
        {
          id: "repo.another.rule",
          diagnosticId: first.manifest.rules[0]!.diagnosticId,
          capabilityId: "repo.another",
          title: "Duplicate diagnostic",
          description: "Synthetic duplicate diagnostic.",
          explanation: "Used to verify registry collisions.",
          defaultSeverity: "error",
        },
      ],
      providers: [],
    });
    expect(() => createQualityRegistry([first, duplicateDiagnostic])).toThrow(
      `Diagnostic ${first.manifest.rules[0]!.diagnosticId} has more than one owner`,
    );
  });
});
