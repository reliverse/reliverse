import { describe, expect, test } from "bun:test";

import { formatDoctorSummary } from "../_shared";

describe("doctor output", () => {
  test("explains what to do when only 7z is missing", () => {
    const output = formatDoctorSummary([
      {
        id: "system-tar",
        available: true,
        formats: ["tar", "tar.gz", "tar.zst"],
      },
      {
        id: "system-zip",
        available: true,
        formats: ["zip"],
      },
      {
        id: "system-7z",
        available: false,
        formats: ["7z"],
      },
    ]);

    expect(output).toContain("Relpack doctor");
    expect(output).toContain("Status: usable with warnings");
    expect(output).toContain("Only .7z support is unavailable");
    expect(output).toContain("Install the missing backend only if you need: 7z");
    expect(output).toContain("rse relpack pack ./dist -o dist.tar.zst --apply");
  });
});
