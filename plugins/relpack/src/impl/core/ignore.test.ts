import { describe, expect, test } from "bun:test";

import {
  DEFAULT_IGNORED_NAMES,
  buildIgnoredNames,
  parseIgnoredNameInput,
  toArchiveExcludePatterns,
} from "./ignore";

describe("default ignore policy", () => {
  test("blocks common generated and secret names by default", () => {
    const ignoredNames = buildIgnoredNames({ includeDefaultIgnores: true });

    expect(ignoredNames).toContain(".git");
    expect(ignoredNames).toContain("node_modules");
    expect(ignoredNames).toContain("dist");
    expect(ignoredNames).toContain(".env");
    expect(DEFAULT_IGNORED_NAMES.has(".bun")).toBe(true);
  });

  test("supports custom-only ignore names", () => {
    const ignoredNames = buildIgnoredNames({
      includeDefaultIgnores: false,
      extraIgnoredNames: ["custom-cache"],
    });

    expect(ignoredNames).toEqual(["custom-cache"]);
    expect(ignoredNames).not.toContain("node_modules");
  });

  test("parses comma-separated ignore names", () => {
    expect(parseIgnoredNameInput("foo, bar,,baz/")).toEqual(["foo", "bar", "baz"]);
  });

  test("expands names into backend exclude patterns", () => {
    const patterns = toArchiveExcludePatterns(["node_modules"]);

    expect(patterns).toContain("node_modules");
    expect(patterns).toContain("node_modules/*");
    expect(patterns).toContain("*/node_modules");
    expect(patterns).toContain("*/node_modules/*");
  });
});
