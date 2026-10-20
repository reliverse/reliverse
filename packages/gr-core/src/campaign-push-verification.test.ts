import { expect, test } from "bun:test";

import { assertGrCampaignPushCommit, pushGrCampaign } from "./campaign";
import { GrError } from "./error";

test("final commit-chain drift is rejected before publication", () => {
  expect(() => assertGrCampaignPushCommit("approved", "foreign", "before-push")).toThrow(
    "push was not attempted",
  );
  try {
    assertGrCampaignPushCommit("approved", "foreign", "before-push");
  } catch (error) {
    expect((error as GrError).details.outcome).toBe("not-attempted");
  }
  expect(() => assertGrCampaignPushCommit("approved", "approved", "before-push")).not.toThrow();
});
test("remote readback failure or drift remains uncertain and cannot grant retry", () => {
  for (const observed of ["", "foreign"]) {
    try {
      assertGrCampaignPushCommit("approved", observed, "after-push");
      throw new Error("Expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(GrError);
      expect((error as GrError).details.outcome).toBe("uncertain");
      expect((error as Error).message).toContain("no retry authority");
    }
  }
  expect(() => assertGrCampaignPushCommit("approved", "approved", "after-push")).not.toThrow();
});
test("absence of effects denies the push API without spawning Git or a campaign", async () => {
  await expect(
    pushGrCampaign({ root: "/not-a-repository", plan: {} as never, grantedEffects: [] }),
  ).rejects.toThrow();
});
