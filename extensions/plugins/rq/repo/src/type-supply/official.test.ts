import { expect, test } from "bun:test";

import { OFFICIAL_TYPE_SUPPLY } from "./official";

test("reviewed Bun type supply follows the canonical Bun 1.4.2 toolchain", () => {
  expect(OFFICIAL_TYPE_SUPPLY["@types/bun"]).toBe("1.4.2");
  expect(OFFICIAL_TYPE_SUPPLY["bun-types"]).toBe("1.4.2");
});
