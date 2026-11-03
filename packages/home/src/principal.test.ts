import { expect, test } from "bun:test";
import path from "node:path";

import { createReliverseHomePathSet, isOpaquePrincipalDirectoryName } from "./paths";
import {
  createReliversePrincipal,
  revokeReliversePrincipal,
  validateReliversePrincipal,
} from "./principal";

test("Principal paths reject invalid runtime IDs before joining managed directories", () => {
  const root = path.resolve("fixture-home"),
    id = "prn_00000000000000000000000000000001";
  expect(createReliverseHomePathSet(root, id).defaultPrincipal).toBe(
    path.join(root, "principals", id, "principal.json"),
  );
  for (const value of [
    "../../outside",
    "../prn_00000000000000000000000000000001",
    "prn_short",
    id + "/../outside",
    id + String.fromCharCode(0),
    " " + id,
    [id],
    null,
  ]) {
    expect(isOpaquePrincipalDirectoryName(value as string)).toBe(false);
    expect(() => createReliverseHomePathSet(root, value as typeof id)).toThrow(
      "RELIVERSE_PRINCIPAL_ID_INVALID",
    );
  }
});

test("Principal kinds share one explicit active and revoked lifecycle", () => {
  for (const principalKind of ["human", "agent", "organization", "service", "device"] as const) {
    const principal = createReliversePrincipal({
      id: "prn_00000000000000000000000000000001",
      handle: `owner-${principalKind}`,
      principalKind,
      createdAt: "2026-09-13T12:00:00.000Z",
    });
    expect(principal.status).toBe("active");
    expect(validateReliversePrincipal(principal)).toEqual([]);

    const revoked = revokeReliversePrincipal(principal, {
      at: "2026-09-13T12:01:00.000Z",
      reason: "identity retired",
    });
    expect(revoked).toMatchObject({
      id: principal.id,
      principalKind,
      status: "revoked",
      revokedAt: "2026-09-13T12:01:00.000Z",
      revocationReason: "identity retired",
    });
    expect(validateReliversePrincipal(revoked)).toEqual([]);
  }
});
