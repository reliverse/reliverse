import { describe, expect, test } from "bun:test";

import { assertSafeArchiveEntryPath, toArchiveInputPath } from "./path-safety";

describe("archive path safety", () => {
  test("accepts normal relative paths", () => {
    expect(assertSafeArchiveEntryPath("src/index.ts")).toBe("src/index.ts");
  });

  test("rejects traversal", () => {
    expect(() => assertSafeArchiveEntryPath("../secret")).toThrow();
    expect(() => assertSafeArchiveEntryPath("src/../../secret")).toThrow();
  });

  test("rejects absolute paths and Windows drive prefixes", () => {
    expect(() => assertSafeArchiveEntryPath("/etc/passwd")).toThrow();
    expect(() => assertSafeArchiveEntryPath("C:/Users/file.txt")).toThrow();
  });

  test("rejects reserved Windows device names", () => {
    expect(() => assertSafeArchiveEntryPath("src/CON.txt")).toThrow();
  });

  test("allows current directory as an input path for packing", () => {
    expect(toArchiveInputPath("/tmp/project", ".")).toBe(".");
  });
});
