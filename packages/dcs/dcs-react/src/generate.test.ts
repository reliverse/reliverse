import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

import { createConfigContractBundle } from "@reliverse/dcs-contract";

import { generateDcsReactUi, normalizeDcsUiPreset } from "./generate";

test("tailwind-shadcn-v4 codegen emits semantic owned sources", async () => {
  const fixture = new URL(
    "../../dcs-conformance/fixtures/013-ui-codegen/ui-demo.config-contract.json",
    import.meta.url,
  );
  const bundle = createConfigContractBundle(
    JSON.parse(await readFile(fixture, "utf8")) as Parameters<typeof createConfigContractBundle>[0],
  );
  const generation = await generateDcsReactUi({
    bundle,
    emitTheme: true,
    preset: "tailwind-shadcn-v4",
  });
  const form = generation.files.find(
    (entry) => entry.filename === "PlaygroundConfigForm.tsx",
  )?.content;
  const manifest = generation.files.find(
    (entry) => entry.filename === "dcs-ui.manifest.json",
  )?.content;

  expect(generation.componentName).toBe("PlaygroundConfig");
  expect(form).toContain('className="border-border bg-card text-card-foreground"');
  expect(form).toContain("text-muted-foreground");
  expect(form).not.toContain("bg-zinc-");
  expect(form).not.toContain("$secret");
  expect(manifest).toContain("tailwind-shadcn-v4");
  expect(generation.files.some((entry) => entry.filename === "dcs-theme.css")).toBe(true);
});

test("legacy CSS flag normalizes to the Tailwind v4 shadcn preset", () => {
  expect(normalizeDcsUiPreset({ cssFramework: "tailwind-shadcn-preset" })).toBe(
    "tailwind-shadcn-v4",
  );
  expect(normalizeDcsUiPreset({ preset: "react-headless" })).toBe("react-headless");
});
