import { expect, test } from "bun:test";

import {
  assertRvsUserDelegationUsable,
  createRvsUserDelegationForDuration,
  resolveRvsUserDelegationExpiry,
} from "./delegation";
const issuedAt = "2026-10-07T21:00:00.000Z";
const authorityExpiresAt = ["2026-10-10T21:00:00.000Z"];

test("hours and days are exact elapsed UTC durations, not calendar/DST or a rolling renewal", () => {
  expect(resolveRvsUserDelegationExpiry({ duration: "24h", issuedAt, authorityExpiresAt })).toBe(
    "2026-10-08T21:00:00.000Z",
  );
  expect(resolveRvsUserDelegationExpiry({ duration: "1d", issuedAt, authorityExpiresAt })).toBe(
    "2026-10-08T21:00:00.000Z",
  );
  expect(resolveRvsUserDelegationExpiry({ duration: "2d", issuedAt, authorityExpiresAt })).toBe(
    "2026-10-09T21:00:00.000Z",
  );
});

for (const duration of [
  "",
  "0h",
  "-1d",
  "1.5h",
  "24",
  "24H",
  " 24h",
  "24h ",
  "1h2d",
  "01h",
  "Infinityh",
  "9007199254740992h",
  "9007199254740d",
]) {
  test("rejects invalid/overflow duration " + JSON.stringify(duration), () => {
    expect(() =>
      resolveRvsUserDelegationExpiry({ duration, issuedAt, authorityExpiresAt }),
    ).toThrow("DURATION_INVALID");
  });
}

test("every authority expiry bounds duration; never silently clips, ignores invalid bounds or widens them", () => {
  expect(() =>
    resolveRvsUserDelegationExpiry({ duration: "24h", issuedAt, authorityExpiresAt: [] }),
  ).toThrow("VALIDITY_BOUND_REQUIRED");
  expect(() =>
    resolveRvsUserDelegationExpiry({ duration: "24h", issuedAt: "invalid", authorityExpiresAt }),
  ).toThrow("TIME_INVALID");
  expect(() =>
    resolveRvsUserDelegationExpiry({ duration: "24h", issuedAt, authorityExpiresAt: ["invalid"] }),
  ).toThrow("TIME_INVALID");
  expect(() =>
    resolveRvsUserDelegationExpiry({
      duration: "24h",
      issuedAt,
      authorityExpiresAt: [...authorityExpiresAt, "2026-10-08T09:08:00.400Z"],
    }),
  ).toThrow("DELEGATION_AMPLIFICATION");
  expect(() =>
    resolveRvsUserDelegationExpiry({ duration: "24h", issuedAt, authorityExpiresAt: [issuedAt] }),
  ).toThrow("DELEGATION_AMPLIFICATION");
});

test("timed UF identity keeps scope/authority references, has exact expiry and grants no signer or lease", () => {
  const input = {
    id: "dlg.timed",
    delegator: { id: "owner", kind: "human" as const },
    delegate: { id: "agent", kind: "agent" as const },
    actingFor: { id: "prn_00000000000000000000000000000001" as const, kind: "human" as const },
    authorityRefs: [
      {
        kind: "delegation-claim" as const,
        id: "signed.owner.claim",
        digest: `sha256:${"a".repeat(64)}` as const,
      },
    ],
    envelope: {
      capabilities: ["quality.test"],
      resourceScopes: ["repo:reliverse"],
      effectClasses: ["workspace.execute"],
      executionPlacements: ["local" as const],
      maxUses: 1,
      maxCostMicros: 0,
      remainingDelegationDepth: 0,
      redelegation: false,
    },
    duration: "24h",
    createdAt: issuedAt,
    authorityExpiresAt,
    purpose: "bounded quality",
    workTurnId: "wt.quality",
  };
  const delegation = createRvsUserDelegationForDuration(input);
  expect(delegation.authorityRefs).toEqual(input.authorityRefs);
  expect(delegation.envelope).toEqual({ ...input.envelope, expiresAt: "2026-10-08T21:00:00.000Z" });
  expect(delegation.createdAt).toBe(issuedAt);
  expect(() =>
    assertRvsUserDelegationUsable([delegation], "2026-10-08T20:59:59.999Z"),
  ).not.toThrow();
  expect(() => assertRvsUserDelegationUsable([delegation], "2026-10-08T21:00:00.000Z")).toThrow(
    "DELEGATION_EXPIRED",
  );
  expect(() => createRvsUserDelegationForDuration({ ...input, authorityRefs: [] })).toThrow(
    "AUTHORITY_REF_REQUIRED",
  );
});
