import { describe, expect, test } from "bun:test";

import {
  assertGatehouseActionIntent,
  createGatehouseActionIntent,
  fingerprintGatehouseValue,
  canonicalizeGatehouseValue,
  GATEHOUSE_NEVER_EXPIRES_AT,
} from "./index";

const policyDigest = fingerprintGatehouseValue({ id: "policy:test", revision: 1 });

function createIntent(
  parameters: { readonly branch: string; readonly force: boolean },
  expiresAt?: string,
) {
  return createGatehouseActionIntent({
    id: "intent:test",
    nonce: "nonce:test",
    createdAt: "2026-08-04T18:00:00.000Z",
    ...(expiresAt ? { expiresAt } : {}),
    action: {
      authorityImpact: "none",
      effectClass: "git.push",
      kind: "gr.publish",
    },
    requester: { id: "principal:rse-agent:jim", kind: "agent" },
    actor: { id: "principal:rse-agent:jim", kind: "agent" },
    accountableSystem: { id: "principal:service:gr", kind: "service" },
    target: { id: "repository:reliverse", kind: "repository", parameters },
    preconditions: { remoteHead: "abc" },
    requestedCapability: {
      capability: "gr.publish",
      executorClass: "gr-publication-executor",
      scope: { branch: parameters.branch, remote: "origin" },
    },
    policy: {
      authority: {
        independence: "distinct-perspectives",
        kind: "all-of",
        principalIds: ["principal:human:operator", "principal:rse-agent:jim"],
      },
      digest: policyDigest,
      id: "policy:gr-publication",
    },
    presentation: {
      consequences: ["Updates the public remote branch."],
      summary: "Publish the reviewed Reliverse branch.",
      title: "Publish Reliverse",
    },
    reversibility: "compensatable",
    risk: "high",
  });
}

describe("Gatehouse protocol", () => {
  test("canonical digests are independent from object key order", () => {
    expect(fingerprintGatehouseValue({ b: 2, a: 1 })).toBe(
      fingerprintGatehouseValue({ a: 1, b: 2 }),
    );
  });

  test("canonical JSON refuses non-JSON objects, cycles and sparse arrays instead of aliasing valid payloads", () => {
    for (const value of [
      new Date(0),
      new Map(),
      new Set(),
      new Uint8Array(),
      Object.create({ inherited: true }),
    ])
      expect(() => fingerprintGatehouseValue(value)).toThrow("plain objects");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const array: unknown[] = [];
    array.push(array);
    expect(() => fingerprintGatehouseValue(cyclic)).toThrow("circular");
    expect(() => fingerprintGatehouseValue(array)).toThrow("circular");
    expect(() => fingerprintGatehouseValue(new Array(1))).toThrow("undefined");
    const shared = { enabled: true };
    expect(fingerprintGatehouseValue({ a: shared, b: shared })).toBe(
      fingerprintGatehouseValue({ a: { enabled: true }, b: { enabled: true } }),
    );
    expect(canonicalizeGatehouseValue({ a: 1, optional: undefined })).toBe('{"a":1}');
    const payload = JSON.parse('{"__proto__":{"enabled":true}}');
    expect(canonicalizeGatehouseValue(payload)).toBe('{"__proto__":{"enabled":true}}');
    expect(fingerprintGatehouseValue(payload)).not.toBe(fingerprintGatehouseValue({}));
  });

  test("defaults intent expiration to canonical never while allowing surface overrides", () => {
    expect(createIntent({ branch: "main", force: false }).expiresAt).toBe(
      GATEHOUSE_NEVER_EXPIRES_AT,
    );
    expect(
      createIntent({ branch: "main", force: false }, "2026-08-04T19:00:00.000Z").expiresAt,
    ).toBe("2026-08-04T19:00:00.000Z");
  });

  test("binds the exact immutable semantic action", () => {
    const intent = createIntent({ branch: "main", force: false });
    assertGatehouseActionIntent(intent);
    expect(createIntent({ force: false, branch: "main" }).digest).toBe(intent.digest);
    expect(createIntent({ branch: "main", force: true }).digest).not.toBe(intent.digest);
  });

  test("rejects a tampered intent", () => {
    const intent = createIntent({ branch: "main", force: false });
    expect(() =>
      assertGatehouseActionIntent({
        ...intent,
        presentation: { ...intent.presentation, title: "Something else" },
      }),
    ).toThrow("digest does not match");
  });
});
