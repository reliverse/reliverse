import { expect, test } from "bun:test";

import { buildDcsArtifacts, c, defineConfig } from "./index";

const config = defineConfig({
  fileStem: "demo-tool",
  id: "org.example.demo-tool",
  root: c.object({
    enabled: c.boolean().default(true).presentation({
      control: "checkbox",
      description: "Allow the feature.",
      group: "General",
      label: "Feature enabled",
      order: 10,
    }),
    mode: c.enum(["safe", "fast"] as const).default("safe"),
    token: c.secretReference(),
  }),
});

test("SDK build adds types and a manifest without non-deterministic metadata", async () => {
  const direct = await buildDcsArtifacts(config.bundle);
  const throughDefinition = await config.buildArtifacts();
  expect(direct.artifacts).toHaveLength(9);
  const irArtifact = throughDefinition.artifacts.find((artifact) => artifact.kind === "config-ir");
  expect(irArtifact?.filename).toBe("demo-tool.config-ir.json");
  expect(irArtifact?.content).toContain('"format":"dcs-config-ir"');
  expect(throughDefinition.artifacts).toHaveLength(10);

  const declaration = direct.artifacts.find(
    (artifact) => artifact.kind === "typescript-declaration",
  );
  const manifest = direct.artifacts.find((artifact) => artifact.kind === "artifact-manifest");
  expect(declaration?.filename).toBe("demo-tool.config.d.ts");
  expect(declaration?.content).toContain("export interface DemoToolConfig");
  expect(declaration?.content).toContain("readonly enabled: boolean;");
  expect(declaration?.content).toContain("DcsSecretReference");
  expect(declaration?.content).not.toContain("generated at");
  expect(manifest?.content).toContain("dcs-artifact-manifest");
  expect(direct.artifacts).toHaveLength(9);
});
