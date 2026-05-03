import { describe, expect, test } from "bun:test";

import { detectArchiveFormat, normalizeArchiveFormat } from "./format";

describe("archive format detection", () => {
  test("detects compound tar formats", () => {
    expect(detectArchiveFormat("dist.tar.gz")).toBe("tar.gz");
    expect(detectArchiveFormat("dist.tar.zst")).toBe("tar.zst");
    expect(detectArchiveFormat("dist.tar.xz")).toBe("tar.xz");
    expect(detectArchiveFormat("dist.tar.bz2")).toBe("tar.bz2");
  });

  test("normalizes shorthand formats", () => {
    expect(normalizeArchiveFormat("tgz")).toBe("tar.gz");
    expect(normalizeArchiveFormat("tzst")).toBe("tar.zst");
    expect(normalizeArchiveFormat("txz")).toBe("tar.xz");
    expect(normalizeArchiveFormat("tbz2")).toBe("tar.bz2");
  });
});
