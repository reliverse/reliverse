import { expect, test } from "bun:test";

import {
  createDcsConfigIrArtifact,
  generateConfigContractBundleFromIr,
  parseDcsConfigIrArtifact,
  serializeDcsConfigIrArtifact,
} from "./index";

test("a language-neutral Config IR produces a portable CCB", () => {
  const bundle = generateConfigContractBundleFromIr({
    $dcs: {
      contractVersion: 1,
      documentVersion: 1,
      fileStem: "portable-demo",
      id: "org.reliverse.portable-demo",
      specVersion: "0.0.1",
    },
    root: {
      kind: "object",
      merge: "replace",
      nullable: false,
      optional: false,
      resettable: true,
      scopes: ["user", "workspace", "local", "invocation"],
      secret: false,
      shape: {
        enabled: {
          defaultValue: true,
          kind: "boolean",
          merge: "replace",
          nullable: false,
          optional: false,
          resettable: true,
          scopes: ["user", "workspace"],
          secret: false,
        },
      },
    },
  });

  expect(bundle.defaults).toEqual({ enabled: true });
  expect(bundle.fields["/enabled"]?.scopes).toEqual(["user", "workspace"]);
  expect(bundle.schema.properties).toEqual({ enabled: { type: "boolean" } });
});

test("Config IR emits a versioned inspectable artifact without changing CCB authority", () => {
  const ir = {
    $dcs: {
      contractVersion: 1,
      documentVersion: 1,
      fileStem: "portable-demo",
      id: "org.reliverse.portable-demo",
      specVersion: "0.0.1",
    },
    root: {
      kind: "object" as const,
      merge: "replace" as const,
      nullable: false,
      optional: false,
      resettable: true,
      scopes: ["user", "workspace", "local", "invocation"] as const,
      secret: false,
      shape: {
        enabled: {
          defaultValue: true,
          kind: "boolean" as const,
          merge: "replace" as const,
          nullable: false,
          optional: false,
          resettable: true,
          scopes: ["user", "workspace"] as const,
          secret: false,
        },
      },
    },
  };
  const artifact = createDcsConfigIrArtifact(ir);
  const text = serializeDcsConfigIrArtifact(ir);
  expect(artifact.$dcs).toMatchObject({ format: "dcs-config-ir", version: "0.0.1" });
  expect(parseDcsConfigIrArtifact(text)).toEqual(artifact);
  expect(text).toContain('"format":"dcs-config-ir"');
});
