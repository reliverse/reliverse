import { expect, test } from "bun:test";

import { verifyRemptsParity } from "./parity";

test("RQ rejects behavior or exit divergence even when semantic manifests match", () => {
  const source = { exitCode: 0, stdout: '{"value":1}', stderr: "" };
  expect(() => verifyRemptsParity(source, { ...source })).not.toThrow();
  expect(() => verifyRemptsParity(source, { ...source, exitCode: 1 })).toThrow("exitCode");
  expect(() => verifyRemptsParity(source, { ...source, stdout: '{"value":2}' })).toThrow("stdout");
  expect(() => verifyRemptsParity(source, { ...source, stderr: "unexpected effect" })).toThrow(
    "stderr",
  );
});
