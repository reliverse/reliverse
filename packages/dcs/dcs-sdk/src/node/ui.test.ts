import { test, expect } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createConfigContractBundle } from "@reliverse/dcs-contract";

import { DcsUiGeneratedSourceConflictError, doctorDcsUiProject, generateDcsUi } from "./ui";

const fixtureRoot = new URL("../../../dcs-conformance/fixtures/013-ui-codegen/", import.meta.url);

test("UI doctor accepts the Tailwind v4 shadcn fixture and generation avoids global mutations", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "dcs-ui-doctor-"));
  try {
    await cp(new URL("./project/", fixtureRoot), workspace, { recursive: true });
    const beforeCss = await readFile(path.join(workspace, "styles/globals.css"), "utf8");
    const bundle = createConfigContractBundle(
      JSON.parse(
        await readFile(new URL("./ui-demo.config-contract.json", fixtureRoot), "utf8"),
      ) as Parameters<typeof createConfigContractBundle>[0],
    );
    const doctor = await doctorDcsUiProject({
      preset: "tailwind-shadcn-v4",
      workspaceRoot: workspace,
    });
    expect(doctor.compatible).toBe(true);
    expect(doctor.checks.filter((entry) => entry.status === "fail")).toHaveLength(0);

    const result = await generateDcsUi({
      bundle,
      emitTheme: true,
      outputDirectory: "src/generated/dcs/playground",
      preset: "tailwind-shadcn-v4",
      workspaceRoot: workspace,
    });
    expect(result.written).toContain("PlaygroundConfigForm.tsx");
    expect(await readFile(path.join(workspace, "styles/globals.css"), "utf8")).toBe(beforeCss);
    expect(
      await readFile(
        path.join(workspace, "src/generated/dcs/playground/PlaygroundConfigForm.tsx"),
        "utf8",
      ),
    ).toContain("Save changes");
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test("UI generation rejects modified owned source without force", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "dcs-ui-conflict-"));
  try {
    await cp(new URL("./project/", fixtureRoot), workspace, { recursive: true });
    const bundle = createConfigContractBundle(
      JSON.parse(
        await readFile(new URL("./ui-demo.config-contract.json", fixtureRoot), "utf8"),
      ) as Parameters<typeof createConfigContractBundle>[0],
    );
    const options = {
      bundle,
      outputDirectory: "src/generated/dcs/playground",
      preset: "tailwind-shadcn-v4" as const,
      workspaceRoot: workspace,
    };
    await generateDcsUi(options);
    const output = path.join(workspace, "src/generated/dcs/playground/PlaygroundConfigForm.tsx");
    await writeFile(output, "// product changed this intentionally\n", "utf8");
    await expect(generateDcsUi(options)).rejects.toBeInstanceOf(DcsUiGeneratedSourceConflictError);
    await generateDcsUi({ ...options, force: true });
    expect(await readFile(output, "utf8")).toContain("Save changes");
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test("UI doctor rejects Tailwind v3 and disabled CSS variables", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "dcs-ui-incompatible-"));
  try {
    await cp(new URL("./project/", fixtureRoot), workspace, { recursive: true });
    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify(
        { dependencies: { react: "^19.0.0" }, devDependencies: { tailwindcss: "^3.4.0" } },
        null,
        2,
      ),
    );
    await writeFile(
      path.join(workspace, "components.json"),
      JSON.stringify(
        {
          tailwind: { css: "styles/globals.css", cssVariables: false },
          aliases: { ui: "@/components/ui" },
        },
        null,
        2,
      ),
    );
    const doctor = await doctorDcsUiProject({
      cssFramework: "tailwind-shadcn-preset",
      workspaceRoot: workspace,
    });
    expect(doctor.compatible).toBe(false);
    expect(doctor.checks.some((entry) => entry.code === "DCS7003" && entry.status === "fail")).toBe(
      true,
    );
    expect(doctor.checks.some((entry) => entry.code === "DCS7005" && entry.status === "fail")).toBe(
      true,
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});
