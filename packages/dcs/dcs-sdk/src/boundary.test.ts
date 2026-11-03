import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import * as browserSafeSdk from "./index";

test("the SDK root stays browser-safe while host adapters use explicit subpaths", async () => {
  const [index, manifest] = await Promise.all([
    readFile(new URL("./index.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  expect(index).not.toMatch(/from\s+["']node:/);
  expect(index).not.toContain("./node/");
  expect(manifest).toContain('"./node"');
  expect(manifest).toContain('"./bun"');
  expect(browserSafeSdk.defineConfig).toBeDefined();
  expect(browserSafeSdk.applyDcsDocumentPatch).toBeDefined();
});
