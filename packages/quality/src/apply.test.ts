import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createQualityRegistry,
  defineQualitySuite,
  fingerprintJson,
  fingerprintQualityPath,
  fingerprintQualityPlanPaths,
  normalizeQualityChangeOperations,
  parseQualityApplyReceipt,
  parseQualityChangePlan,
  parseQualityVerificationReceipt,
  type QualityChangeOperation,
  type QualityChangePlan,
  type QualityPrecondition,
  type QualityRisk,
  type QualitySuite,
  type QualityVerificationStep,
} from "./index";

const applyEffects = [
  {
    kind: "filesystem.read" as const,
    reason: "Read synthetic target state.",
    operations: ["check", "apply", "verify"] as const,
  },
  {
    kind: "filesystem.write" as const,
    reason: "Write synthetic target files.",
    operations: ["apply"] as const,
  },
  {
    kind: "filesystem.rename" as const,
    reason: "Rename synthetic target files.",
    operations: ["apply"] as const,
  },
  {
    kind: "filesystem.delete" as const,
    reason: "Delete synthetic target files.",
    operations: ["apply"] as const,
  },
];

function createApplySuite(): QualitySuite {
  return defineQualitySuite({
    id: "fixture",
    title: "Apply fixture",
    description: "Synthetic suite for controlled apply tests.",
    capabilities: [
      {
        id: "fixture.files",
        title: "Fixture files",
        description: "Checks and applies fixture file changes.",
        operations: ["check", "plan", "apply", "verify"],
        defaultProvider: "fixture.files.builtin",
        providers: ["fixture.files.builtin"],
        effects: applyEffects,
      },
    ],
    rules: [
      {
        id: "fixture.files.legacy",
        diagnosticId: "RQ-FIXTURE-FILES-LEGACY",
        capabilityId: "fixture.files",
        title: "Legacy fixture value",
        description: "Synthetic JSON contains its legacy value.",
        explanation: "The fixture plan replaces the legacy value.",
        defaultSeverity: "error",
      },
    ],
    providers: [
      {
        id: "fixture.files.builtin",
        capabilityId: "fixture.files",
        title: "Fixture provider",
        version: "0.0.1",
        operations: ["check", "plan", "apply", "verify"],
        determinism: "deterministic",
        effects: applyEffects,
      },
    ],
    checks: {
      "fixture.files": async ({ target }) => {
        const manifestPath = path.join(target.root!, "data.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { name?: string };
        return manifest.name === "old"
          ? [
              {
                ruleId: "fixture.files.legacy",
                message: "Fixture still uses the legacy value.",
                path: "data.json",
              },
            ]
          : [];
      },
    },
  });
}

async function createFixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "rq-apply-fixture-"));
  await Promise.all([
    writeFile(
      path.join(root, "data.json"),
      `${JSON.stringify({ name: "old", stable: true }, null, 2)}\n`,
    ),
    writeFile(path.join(root, "text.txt"), "old and old\n"),
    writeFile(path.join(root, "move.txt"), "move me\n"),
    writeFile(path.join(root, "rename.txt"), "rename me\n"),
    writeFile(path.join(root, "delete.txt"), "delete me\n"),
  ]);
  return root;
}

async function createCompletePlan(
  suite: QualitySuite,
  root: string,
  options: {
    readonly applicable?: boolean;
    readonly operations?: readonly QualityChangeOperation[];
    readonly preconditions?: readonly QualityPrecondition[];
    readonly risks?: readonly QualityRisk[];
    readonly targetContentFingerprint?: string;
    readonly verification?: readonly QualityVerificationStep[];
    readonly manualItems?: QualityChangePlan["manualItems"];
  } = {},
): Promise<QualityChangePlan> {
  const file = async (name: string) => fingerprintQualityPath(path.join(root, name));
  const operations = normalizeQualityChangeOperations(
    options.operations ?? [
      {
        id: "create-file",
        kind: "create-file",
        path: "created.txt",
        content: "created\n",
        targetMustBeAbsent: true,
      },
      {
        id: "delete-file",
        kind: "delete-path",
        path: "delete.txt",
        beforeFingerprint: await file("delete.txt"),
      },
      {
        id: "move-file",
        kind: "move-path",
        from: "move.txt",
        to: "moved.txt",
        sourceFingerprint: await file("move.txt"),
        targetMustBeAbsent: true,
      },
      {
        id: "rename-file",
        kind: "rename-path",
        from: "rename.txt",
        to: "renamed.txt",
        sourceFingerprint: await file("rename.txt"),
        targetMustBeAbsent: true,
      },
      {
        id: "replace-text",
        kind: "replace-text",
        path: "text.txt",
        before: "old",
        after: "new",
        expectedOccurrences: 2,
        fileFingerprint: await file("text.txt"),
      },
      {
        id: "write-json",
        kind: "write-json",
        path: "data.json",
        pointer: "/name",
        before: "old",
        after: "new",
        fileFingerprint: await file("data.json"),
      },
    ],
  );
  const preconditions =
    options.preconditions ??
    operations.flatMap((operation): readonly QualityPrecondition[] => {
      if (operation.kind === "create-file") {
        return [{ id: `${operation.id}-absent`, kind: "path-absent", path: operation.path }];
      }
      if ("from" in operation) {
        return [
          {
            id: `${operation.id}-source`,
            kind: "file-fingerprint",
            path: operation.from,
            expected: operation.sourceFingerprint,
          },
          { id: `${operation.id}-target`, kind: "path-absent", path: operation.to },
        ];
      }
      if (operation.kind === "delete-path") {
        return [
          {
            id: `${operation.id}-file`,
            kind: "file-fingerprint",
            path: operation.path,
            expected: operation.beforeFingerprint,
          },
        ];
      }
      if (operation.kind === "replace-text") {
        return [
          {
            id: `${operation.id}-file`,
            kind: "file-fingerprint",
            path: operation.path,
            expected: operation.fileFingerprint,
          },
        ];
      }
      return [
        {
          id: `${operation.id}-file`,
          kind: "file-fingerprint",
          path: operation.path,
          expected: operation.fileFingerprint,
        },
        {
          id: `${operation.id}-value`,
          kind: "json-value",
          path: operation.path,
          pointer: operation.pointer,
          expected: operation.before,
        },
      ];
    });
  const registry = createQualityRegistry([suite]);
  const beforeCheck = await registry.check({
    capabilityId: "fixture.files",
    target: { kind: "repository", id: "fixture", root },
    grantedEffects: ["filesystem.read"],
  });
  const semanticPlan = {
    schemaVersion: "rq.change-plan.v0" as const,
    producer: { pluginId: "fixture-plugin", packageName: "@fixture/rq-plugin" },
    suite: { id: suite.manifest.id, manifestFingerprint: suite.manifestFingerprint },
    capabilityId: "fixture.files",
    provider: { id: "fixture.files.builtin", version: "0.0.1" },
    target: { kind: "repository" as const, id: "fixture", root },
    targetContent: {
      kind: "content" as const,
      fingerprint:
        options.targetContentFingerprint ?? (await fingerprintQualityPlanPaths(root, operations)),
      description: "Synthetic target content evidence, not a VCS snapshot.",
    },
    inputFingerprint: fingerprintJson(null, "rq.plan-input.v0"),
    configFingerprint: fingerprintJson(null, "rq.plan-config.v0"),
    diagnostics: beforeCheck.diagnostics.map((entry) => entry.fingerprint),
    operations,
    preconditions,
    risks: options.risks ?? [],
    verification: options.verification ?? [
      {
        id: "verify-fixture",
        kind: "quality-check" as const,
        capabilityId: "fixture.files",
        description: "Verify the synthetic fixture value.",
      },
    ],
    manualItems: options.manualItems ?? [],
    applicable: options.applicable ?? true,
  };
  const planFingerprint = fingerprintJson(semanticPlan, "rq.change-plan.v0");
  return parseQualityChangePlan({
    ...semanticPlan,
    planId: `rq-plan-${planFingerprint.slice(0, 20)}`,
    planFingerprint,
  });
}

const grants = [
  "filesystem.read",
  "filesystem.write",
  "filesystem.rename",
  "filesystem.delete",
] as const;

function applyRequest(plan: QualityChangePlan) {
  return {
    plan,
    targetRoot: plan.target.root!,
    targetId: plan.target.id,
    authorization: { kind: "cli-flag" as const, source: "fixture --apply" },
    grantedEffects: grants,
    runId: "apply-run-001",
    createdAt: "2026-07-24T00:00:00.000Z",
  };
}

describe("controlled quality apply", () => {
  test("executes all standard operations and verifies separately", async () => {
    const root = await createFixtureRoot();
    try {
      const suite = createApplySuite();
      const registry = createQualityRegistry([suite]);
      const plan = await createCompletePlan(suite, root);
      const receipt = await registry.apply(applyRequest(plan));

      expect(receipt.status).toBe("succeeded");
      expect(receipt.preflight.status).toBe("passed");
      expect(receipt.operations).toHaveLength(6);
      expect(receipt.operations.every((entry) => entry.status === "executed")).toBe(true);
      expect(receipt.receiptFingerprint).toHaveLength(64);
      expect(() => parseQualityApplyReceipt({ ...receipt, status: "failed" })).toThrow(
        "fingerprint does not match",
      );
      expect(JSON.parse(await readFile(path.join(root, "data.json"), "utf8"))).toEqual({
        name: "new",
        stable: true,
      });
      expect(await readFile(path.join(root, "text.txt"), "utf8")).toBe("new and new\n");
      expect(await readFile(path.join(root, "created.txt"), "utf8")).toBe("created\n");
      expect(await readFile(path.join(root, "moved.txt"), "utf8")).toBe("move me\n");
      expect(await readFile(path.join(root, "renamed.txt"), "utf8")).toBe("rename me\n");
      expect(Bun.file(path.join(root, "delete.txt")).exists()).resolves.toBe(false);

      const verification = await registry.verify({
        plan,
        applyReceipt: receipt,
        runId: "verify-run-001",
        createdAt: "2026-07-24T00:01:00.000Z",
        grantedEffects: ["filesystem.read"],
      });
      expect(verification.status).toBe("succeeded");
      expect(verification.steps).toEqual([
        expect.objectContaining({ stepId: "verify-fixture", status: "passed" }),
      ]);
      expect(verification.receiptFingerprint).toHaveLength(64);
      expect(() => parseQualityVerificationReceipt({ ...verification, status: "failed" })).toThrow(
        "fingerprint does not match",
      );

      const repeated = await registry.apply({ ...applyRequest(plan), runId: "apply-run-002" });
      expect(repeated.status).toBe("failed");
      expect(repeated.preflight.failure?.code).toBe("RQ_PLAN_STALE");
      expect(repeated.operations.every((entry) => entry.status === "not-run")).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("rejects absent authorization, blocked plans, and semantic tampering", async () => {
    const root = await createFixtureRoot();
    try {
      const suite = createApplySuite();
      const registry = createQualityRegistry([suite]);
      const plan = await createCompletePlan(suite, root);
      await expect(
        registry.apply({ ...applyRequest(plan), authorization: undefined }),
      ).rejects.toMatchObject({
        code: "RQ_APPLY_NOT_AUTHORIZED",
      });

      const blocked = await createCompletePlan(suite, root, {
        applicable: false,
        risks: [
          {
            id: "blocked",
            level: "blocking",
            title: "Blocked",
            description: "Synthetic blocking risk.",
          },
        ],
      });
      await expect(registry.apply(applyRequest(blocked))).rejects.toMatchObject({
        code: "RQ_PLAN_BLOCKED",
      });

      expect(() =>
        parseQualityChangePlan({
          ...plan,
          operations: plan.operations.map((operation) =>
            operation.kind === "write-json" ? { ...operation, after: "tampered" } : operation,
          ),
        }),
      ).toThrow("fingerprint or id");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("fails a stale preflight before executing any operation", async () => {
    const root = await createFixtureRoot();
    try {
      const suite = createApplySuite();
      const registry = createQualityRegistry([suite]);
      const plan = await createCompletePlan(suite, root);
      await writeFile(path.join(root, "delete.txt"), "changed after planning\n");
      const receipt = await registry.apply(applyRequest(plan));
      expect(receipt.status).toBe("failed");
      expect(receipt.preflight.failure?.code).toBe("RQ_PLAN_STALE");
      expect(receipt.operations.every((entry) => entry.status === "not-run")).toBe(true);
      expect(Bun.file(path.join(root, "created.txt")).exists()).resolves.toBe(false);
      expect(JSON.parse(await readFile(path.join(root, "data.json"), "utf8"))).toMatchObject({
        name: "old",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("rejects a symlink escape during preflight", async () => {
    const root = await createFixtureRoot();
    const outside = await mkdtemp(path.join(tmpdir(), "rq-apply-outside-"));
    try {
      await symlink(outside, path.join(root, "escape"), "dir");
      const suite = createApplySuite();
      const registry = createQualityRegistry([suite]);
      const operation = {
        id: "escape-create",
        kind: "create-file" as const,
        path: "escape/created.txt",
        content: "unsafe\n",
        targetMustBeAbsent: true as const,
      };
      const plan = await createCompletePlan(suite, root, {
        operations: [operation],
        preconditions: [{ id: "escape-absent", kind: "path-absent", path: operation.path }],
        targetContentFingerprint: fingerprintJson("unsafe fixture", "rq.target-content.v0"),
      });
      const receipt = await registry.apply(applyRequest(plan));
      expect(receipt.status).toBe("failed");
      expect(receipt.preflight.failure?.code).toBe("RQ_PLAN_PATH_UNSAFE");
      expect(Bun.file(path.join(outside, "created.txt")).exists()).resolves.toBe(false);
    } finally {
      await Promise.all([
        rm(root, { force: true, recursive: true }),
        rm(outside, { force: true, recursive: true }),
      ]);
    }
  });
});
