import { describe, expect, test } from "bun:test";

import { getGlobalFlagDefinitions, parseGlobalFlags } from "./global-flags";

describe("global interactive flag alias", () => {
  test("help metadata exposes -i as the short alias for --interactive", () => {
    const interactive = getGlobalFlagDefinitions().find((flag) => flag.key === "interactive");

    expect(interactive?.shortName).toBe("i");
  });

  test("-i parses as the interactive global flag", () => {
    const parsed = parseGlobalFlags(["-i", "pm", "update"]);

    expect(parsed.flags.interactive).toBe(true);
    expect(parsed.argv).toEqual(["pm", "update"]);
  });
});
