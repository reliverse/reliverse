import { expect, test } from "bun:test";

import { createGrOwnerExecutionAuthReader } from "./owner-auth-reader";

const pin = {
  principalId: `prn_${"a".repeat(32)}`,
  sessionId: "auth_session_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  author: { name: "Fixture", email: "fixture@example.invalid" },
  authPolicyDigest: `sha256:${"a".repeat(64)}` as const,
};
test("canonical Auth consumer refuses before reading private state when native startup is unadmitted", async () => {
  let checks = 0;
  const read = createGrOwnerExecutionAuthReader(pin, {
    now: () => new Date(),
    assertNativeCurrent: async () => {
      checks++;
      throw new Error("FIXTURE_NATIVE_STARTUP_REFUSED");
    },
  });
  await expect(read()).rejects.toThrow("FIXTURE_NATIVE_STARTUP_REFUSED");
  expect(checks).toBe(1);
});
test("Auth consumer refuses malformed root policy pins without calling any native port", () => {
  let checks = 0;
  expect(() =>
    createGrOwnerExecutionAuthReader(
      { ...pin, authPolicyDigest: "not-a-digest" as `sha256:${string}` },
      {
        now: () => new Date(),
        assertNativeCurrent: async () => {
          checks++;
        },
      },
    ),
  ).toThrow("CANONICAL_READ_REFUSED");
  expect(checks).toBe(0);
});
