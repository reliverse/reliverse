import { expect, test } from "bun:test";

import {
  assertQualityCandidateVerificationReceipt,
  createQualityRegistry,
  defineQualitySuite,
  runQualityCandidateVerification,
  type QualityVerificationCheckRunner,
} from "./index";

function fixture(severity?: "error" | "warning") {
  let calls = 0;
  const suite = defineQualitySuite({
    id: "fixture",
    title: "Fixture",
    description: "Isolated candidate verification fixture, not live RQ acceptance.",
    capabilities: [
      {
        id: "fixture.check",
        title: "Check",
        description: "Read-only check.",
        operations: ["check"],
        defaultProvider: "fixture.check.builtin",
        providers: ["fixture.check.builtin"],
      },
    ],
    providers: [
      {
        id: "fixture.check.builtin",
        capabilityId: "fixture.check",
        title: "Fixture engine",
        version: "1.0.0",
        operations: ["check"],
        determinism: "deterministic",
      },
    ],
    rules: [
      {
        id: "fixture.check.issue",
        diagnosticId: "RQ-FIXTURE-ISSUE",
        capabilityId: "fixture.check",
        title: "Issue",
        description: "Fixture finding.",
        explanation: "Fixture finding.",
        defaultSeverity: "error",
      },
    ],
    checks: {
      "fixture.check": () => {
        calls++;
        return {
          diagnostics: severity
            ? [{ ruleId: "fixture.check.issue", message: "Fixture issue", severity }]
            : [],
        };
      },
    },
  });
  const registry = createQualityRegistry([suite]);
  const request = {
    runId: "fixture-run",
    createdAt: "2026-10-14T00:00:00.000Z",
    target: {
      kind: "repository" as const,
      id: "fixture",
      root: "/isolated-fixture",
      snapshot: "git-tree:fixture",
    },
    candidateFingerprint: "git-tree:fixture",
    executionFingerprint: "fixture-engine-closure",
    observeCandidateFingerprint: async () => "git-tree:fixture",
    observeExecutionFingerprint: async () => "fixture-engine-closure",
    checks: [
      {
        request: {
          capabilityId: "fixture.check",
          providerId: "fixture.check.builtin",
          input: { paths: ["src"] },
          config: { failOn: "error" },
        },
        suiteFingerprint: suite.manifestFingerprint,
        providerVersion: "1.0.0",
      },
    ],
  };
  return { registry, request, calls: () => calls };
}

test("read-only candidate verification reuses primary checks without fabricating apply receipts", async () => {
  const f = fixture();
  const receipt = await runQualityCandidateVerification(f.registry, f.request);
  expect(receipt.status).toBe("succeeded");
  expect(f.calls()).toBe(1);
  expect(receipt).not.toHaveProperty("applyRunId");
  expect(receipt.checks[0]).toMatchObject({
    capabilityId: "fixture.check",
    errorCount: 0,
    provider: { id: "fixture.check.builtin", version: "1.0.0" },
  });
  expect(() =>
    assertQualityCandidateVerificationReceipt(receipt, {
      candidateFingerprint: f.request.candidateFingerprint,
      executionFingerprint: f.request.executionFingerprint,
      policyFingerprint: receipt.policyFingerprint,
    }),
  ).not.toThrow();
  for (const field of [
    "candidateFingerprint",
    "executionFingerprint",
    "policyFingerprint",
  ] as const) {
    const expected = {
      candidateFingerprint: receipt.candidateFingerprint,
      executionFingerprint: receipt.executionFingerprint,
      policyFingerprint: receipt.policyFingerprint,
      [field]: "changed",
    };
    expect(() => assertQualityCandidateVerificationReceipt(receipt, expected)).toThrow();
  }
  expect(() =>
    assertQualityCandidateVerificationReceipt(
      { ...receipt, runId: "tampered" },
      {
        candidateFingerprint: receipt.candidateFingerprint,
        executionFingerprint: receipt.executionFingerprint,
        policyFingerprint: receipt.policyFingerprint,
      },
    ),
  ).toThrow();
});

test("empty checks or unpinned engines cannot produce a Green Gate", async () => {
  const f = fixture();
  await expect(
    runQualityCandidateVerification(f.registry, { ...f.request, checks: [] }),
  ).rejects.toThrow("explicit");
  await expect(
    runQualityCandidateVerification(f.registry, {
      ...f.request,
      checks: [{ ...f.request.checks[0]!, providerVersion: "" }],
    }),
  ).rejects.toThrow();
  expect(f.calls()).toBe(0);
});

test("candidate and execution drift before or during checks invalidate verification", async () => {
  for (const boundary of ["candidate", "execution"] as const) {
    for (const phase of ["before", "during"] as const) {
      const f = fixture();
      let observations = 0;
      const pin =
        boundary === "candidate" ? f.request.candidateFingerprint : f.request.executionFingerprint;
      const observe = async () => {
        observations++;
        return phase === "before" || observations > 1 ? "changed" : pin;
      };
      const request = {
        ...f.request,
        ...(boundary === "candidate"
          ? { observeCandidateFingerprint: observe }
          : { observeExecutionFingerprint: observe }),
      };
      const receipt = await runQualityCandidateVerification(f.registry, request);
      expect(receipt.status).toBe("failed");
      expect(receipt.failure?.message).toContain("changed");
      expect(f.calls()).toBe(phase === "before" ? 0 : 1);
    }
  }
});

test("errors block acceptance while unrelated warnings are preserved without blanket suppression", async () => {
  for (const severity of ["error", "warning"] as const) {
    const f = fixture(severity);
    const receipt = await runQualityCandidateVerification(f.registry, f.request);
    expect(receipt.status).toBe(severity === "error" ? "failed" : "succeeded");
    expect(receipt.checks[0]?.warningCount).toBe(severity === "warning" ? 1 : 0);
  }
});

test("foreign target, provider, suite, config/input and tampered primary results fail closed", async () => {
  for (const field of [
    "target",
    "provider",
    "suite",
    "inputFingerprint",
    "configFingerprint",
    "resultFingerprint",
  ] as const) {
    const f = fixture();
    const runner: QualityVerificationCheckRunner = {
      check: async (request) => {
        const result = await f.registry.check(request);
        const value =
          field === "target"
            ? { ...result.target, root: "/foreign" }
            : field === "provider"
              ? { id: "foreign", version: "1.0.0" }
              : field === "suite"
                ? { ...result.suite, manifestFingerprint: "foreign" }
                : "tampered";
        return { ...result, [field]: value };
      },
    };
    const receipt = await runQualityCandidateVerification(runner, f.request);
    expect(receipt.status).toBe("failed");
    expect(receipt.failure?.message).toContain("pinned");
  }
});

test("request mutation during observation cannot silently substitute the pinned candidate or check", async () => {
  const f = fixture();
  const request = { ...f.request };
  request.observeCandidateFingerprint = async () => {
    request.candidateFingerprint = "substituted";
    request.checks[0]!.request.capabilityId = "foreign.check";
    return "git-tree:fixture";
  };
  const receipt = await runQualityCandidateVerification(f.registry, request);
  expect(receipt.status).toBe("succeeded");
  expect(receipt.candidateFingerprint).toBe("git-tree:fixture");
  expect(receipt.checks[0]?.capabilityId).toBe("fixture.check");
});
