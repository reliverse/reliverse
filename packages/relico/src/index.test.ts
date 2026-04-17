import { describe, expect, test } from "bun:test";

import { createRelico } from "./index";

describe("@reliverse/relico", () => {
  test("returns plain text when colors are disabled", () => {
    const rel = createRelico({ color: false });
    expect(rel.red("x")).toBe("x");
    expect(rel.bold("x")).toBe("x");
  });

  test("renders basic ansi styles when enabled", () => {
    const rel = createRelico({ color: true });
    expect(rel.red("x")).toBe("\u001B[31mx\u001B[39m");
    expect(rel.bgBlue("x")).toBe("\u001B[44mx\u001B[49m");
  });

  test("keeps nested styles balanced", () => {
    const rel = createRelico({ color: true });
    expect(rel.bold(`a ${rel.red("x")} b`)).toBe("\u001B[1ma \u001B[31mx\u001B[39m b\u001B[22m");
  });

  test("reopens styles when nested text already contains a close code", () => {
    const rel = createRelico({ color: true });
    expect(rel.red(`a\u001B[39mb`)).toBe("\u001B[31ma\u001B[39m\u001B[31mb\u001B[39m");
  });

  test("supports explicit level and stream overrides", () => {
    const stdout = createRelico({ color: false, stream: "stdout" });
    const stderr = createRelico({ level: 1, stream: "stderr" });

    expect(stdout.enabled).toBe(false);
    expect(stderr.enabled).toBe(true);
    expect(stderr.stream).toBe("stderr");
  });
});
